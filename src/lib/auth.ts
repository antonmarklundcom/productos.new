import { safeError } from "@/lib/safe-error";
import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { users, type UserRole } from "@/db/schema";

import type { Executor } from "@/domain/executor";
import { hashPassword, verifyPassword } from "./password";

export type AuthenticatedUser = {
  id: number;
  email: string;
  role: UserRole;
  name: string | null;
  sessionVersion: number;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Login del admin. Devuelve `null` en cualquier fallo — nunca distingue
 * "no existe" de "contraseña incorrecta" hacia afuera.
 */
export async function authenticate(
  email: string,
  password: string,
  executor?: Executor
): Promise<AuthenticatedUser | null> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);

  const user = rows[0];
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!ok || !user || !user.isActive) return null;

  // Sólo el login exitoso escribe la marca: un intento fallido no es una
  // entrada, y contarlo convertiría la columna en un contador de ataques en
  // vez de en lo que el dueño necesita —"¿esta cuenta sigue en uso?"— al
  // decidir si desactivarla (PR C).
  //
  // `NOW()` de MySQL y no una fecha de Node: es el mismo reloj con el que se
  // escriben `created_at` y `order_events`, y compararlas contra la hora de
  // otra máquina es cómo aparecen los "entró antes de existir".
  //
  // No revienta el login si falla: quedarse afuera del panel porque no se pudo
  // escribir una columna informativa sería un caso peor que el que resuelve.
  try {
    await tx
      .update(users)
      .set({ lastLoginAt: sql`NOW()` })
      .where(eq(users.id, user.id));
  } catch (error) {
    console.error("No pude registrar last_login_at", safeError(error).message);
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    sessionVersion: user.sessionVersion,
  };
}

/**
 * Alta de usuario del panel. **No hay ruta pública de registro**: esto se llama
 * desde `scripts/create-owner.ts` o desde una acción de admin protegida por
 * `requireOwner()`.
 */
export async function createUser(
  input: {
    email: string;
    password: string;
    name?: string | null;
    role: UserRole;
  },
  executor?: Executor
): Promise<{ id: number; email: string; role: UserRole }> {
  const tx = executor ?? getDb();
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  await tx.insert(users).values({
    email,
    passwordHash,
    name: input.name ?? null,
    role: input.role,
  });

  const rows = await tx
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const created = rows[0];
  if (!created) throw new Error(`No pude crear el usuario ${email}`);
  return { id: created.id, email: created.email, role: created.role };
}
