import { and, asc, eq, or, sql } from "drizzle-orm";
import { withLockRetry } from "@/db/retry";

import { getDb } from "@/db";
import { users, type UserRole } from "@/db/schema";
import { normalizeEmail } from "@/lib/auth";
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  validatePasswordStrength,
} from "@/lib/password";

import type { MessageKey, Params } from "@/i18n";

import { DomainError } from "./errors";
import type { Executor } from "./executor";

/**
 * Gestión de los usuarios del panel (PLAN.md FASE 2, PR C).
 *
 * Es la página que hace al template vendible: el dueño da de alta a su
 * empleada un lunes sin llamar a nadie. Y es también la página que puede
 * dejarlo afuera de su propia tienda, así que todas las reglas duras viven
 * acá —en el dominio, adentro de la transacción— y no en el formulario.
 *
 * **Nadie se borra, todos se desactivan.** No es una preferencia de estilo:
 * `order_events.actor_user_id` y `stock_adjustments.actor_user_id` apuntan a
 * esta tabla, y el historial de lo que hizo una persona tiene que sobrevivir a
 * su salida del comercio. Un `is_active = false` corta el acceso igual de
 * rápido —`authenticate()` lo rechaza— y conserva la auditoría.
 */

export class AdminUserError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = "AdminUserError";
  }
}

export type AdminUserRow = {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
};

export async function listAdminUsers(
  executor?: Executor
): Promise<AdminUserRow[]> {
  const tx = executor ?? getDb();
  return tx
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(asc(users.email));
}

/**
 * Cuántos `owner` activos quedarían si se le aplica `cambio` al usuario dado.
 *
 * La pregunta que contesta es una sola —"¿esto deja la tienda sin dueño?"— y
 * se hace **adentro de la transacción**, con las filas bloqueadas: dos
 * pestañas degradando a los dos últimos owners al mismo tiempo pasan las dos
 * validaciones si cada una mira la foto vieja.
 */
async function lockTargetAndOwners(tx: Executor, userId: number) {
  const rows = await tx
    .select()
    .from(users)
    .where(
      or(
        eq(users.id, userId),
        and(eq(users.role, "owner"), eq(users.isActive, true))
      )
    )
    .orderBy(asc(users.id))
    .for("update");
  const user = rows.find((r) => r.id === userId);
  const otrosOwners = rows.filter(
    (r) => r.id !== userId && r.role === "owner" && r.isActive
  ).length;
  return { user, otrosOwners };
}

export async function createAdminUser(input: {
  email: string;
  password: string;
  name?: string | null;
  role: UserRole;
}): Promise<AdminUserRow> {
  const email = normalizeEmail(input.email);
  if (!email.includes("@"))
    throw new AdminUserError("adminError.usuario.email");

  // `strength.reason` ya es una clave del catálogo, así que se relanza tal
  // cual: el motivo concreto ("al menos 10 caracteres") es lo que le sirve a
  // quien está eligiendo la contraseña.
  const strength = validatePasswordStrength(input.password);
  if (!strength.ok)
    throw new AdminUserError(strength.reason, { minimo: MIN_PASSWORD_LENGTH });

  return getDb().transaction(async (tx) => {
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing[0])
      throw new AdminUserError("adminError.usuario.emailRepetido");

    await tx.insert(users).values({
      email,
      passwordHash: await hashPassword(input.password),
      name: input.name?.trim() || null,
      role: input.role,
    });

    const created = await tx
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const row = created[0];
    if (!row) throw new AdminUserError("adminError.usuario.noPude");

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      isActive: row.isActive,
      createdAt: row.createdAt,
      lastLoginAt: row.lastLoginAt,
    };
  });
}

/**
 * Activar o desactivar. Las dos reglas duras del plan viven acá:
 *
 * 1. **No podés desactivarte a vos mismo.** El caso real es el clic apurado en
 *    la fila equivocada: sin esta regla, el dueño se cierra la puerta y la
 *    única salida es un SSH — o sea, llamar al desarrollador, que es
 *    exactamente lo que esta pantalla existe para evitar.
 * 2. **No podés desactivar al último owner activo.** Una tienda sin dueño
 *    activo no tiene quién cree usuarios, apruebe reembolsos ni baje un CSV.
 */
export async function setAdminUserActive(input: {
  userId: number;
  isActive: boolean;
  actingUserId: number;
}): Promise<void> {
  if (input.userId === input.actingUserId && !input.isActive) {
    throw new AdminUserError("adminError.usuario.noTeDesactives");
  }

  return withLockRetry(() =>
    getDb().transaction(async (tx) => {
      const { user, otrosOwners } = await lockTargetAndOwners(tx, input.userId);
      if (!user) throw new AdminUserError("adminError.usuario.noExiste");

      if (!input.isActive && user.role === "owner" && otrosOwners === 0) {
        throw new AdminUserError("adminError.usuario.ultimoDueno");
      }

      await tx
        .update(users)
        .set({
          isActive: input.isActive,
          sessionVersion: sql`${users.sessionVersion} + 1`,
        })
        .where(eq(users.id, user.id));
    })
  );
}

/**
 * Cambiar el rol. Mismas dos reglas, por el mismo motivo: degradar al último
 * owner deja la tienda sin quién gestione usuarios, y degradarte a vos mismo
 * es la misma puerta cerrada con otro nombre.
 */
export async function setAdminUserRole(input: {
  userId: number;
  role: UserRole;
  actingUserId: number;
}): Promise<void> {
  if (input.userId === input.actingUserId && input.role !== "owner") {
    throw new AdminUserError("adminError.usuario.noTeDegrades");
  }

  return withLockRetry(() =>
    getDb().transaction(async (tx) => {
      const { user, otrosOwners } = await lockTargetAndOwners(tx, input.userId);
      if (!user) throw new AdminUserError("adminError.usuario.noExiste");
      if (user.role === input.role) return;

      if (
        user.role === "owner" &&
        input.role !== "owner" &&
        user.isActive &&
        otrosOwners === 0
      ) {
        throw new AdminUserError("adminError.usuario.ultimoDuenoDegradar");
      }

      await tx
        .update(users)
        .set({
          role: input.role,
          sessionVersion: sql`${users.sessionVersion} + 1`,
        })
        .where(eq(users.id, user.id));
    })
  );
}

/**
 * Resetear la contraseña de otro usuario.
 *
 * La escribe el dueño y se la pasa a la persona por el canal que quiera: no
 * hay email transaccional en este stack (ver NEW-STORE.md), así que inventar
 * un "te mandamos un link" sería mentir. Lo honesto es que la pantalla se lo
 * diga.
 */
export async function resetAdminUserPassword(input: {
  userId: number;
  password: string;
}): Promise<void> {
  const strength = validatePasswordStrength(input.password);
  if (!strength.ok)
    throw new AdminUserError(strength.reason, { minimo: MIN_PASSWORD_LENGTH });

  const passwordHash = await hashPassword(input.password);
  const db = getDb();

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!rows[0]) throw new AdminUserError("adminError.usuario.noExiste");

  await db
    .update(users)
    .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, input.userId));
}
