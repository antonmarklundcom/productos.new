import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import type { MessageKey, Params } from "@/i18n";

import { DomainError } from "./errors";

import { getDb } from "@/db";
import { customers, orders, type OrderStatus } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";
import { normalizePhonePY } from "@/lib/py";

import type { Executor } from "./executor";
import { log, mensajeDe } from "@/lib/log";

/**
 * Cuentas de cliente (PLAN.md FASE 2, PR E).
 *
 * Reglas que valen para todo el archivo:
 *
 * 1. **Un cliente no es un usuario del panel.** Nada de acá escribe `users` ni
 *    lee la sesión de admin.
 * 2. **El login nunca dice si la cuenta existe.** Igual que `authenticate()`:
 *    un solo `null` para "no existe", "contraseña incorrecta" y "desactivada".
 * 3. **El teléfono se guarda normalizado** (`+595XXXXXXXXX`), porque tiene que
 *    poder compararse contra `orders.customer_phone`, que ya se guarda así.
 */

export class CustomerError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = "CustomerError";
  }
}

export type Customer = {
  id: number;
  phone: string;
  email: string | null;
  name: string;
  marketingOptIn: boolean | null;
  phoneVerifiedAt: Date | null;
  sessionVersion: number;
  hasPassword: boolean;
};

export function normalizeCustomerEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Revocation persists across reactivation; previously issued cookies stay invalid. */
export async function setCustomerActive(
  customerId: number,
  isActive: boolean,
  executor?: Executor
): Promise<void> {
  const tx = executor ?? getDb();
  await tx
    .update(customers)
    .set({ isActive, sessionVersion: sql`${customers.sessionVersion} + 1` })
    .where(
      and(eq(customers.id, customerId), eq(customers.isActive, !isActive))
    );
}

/**
 * Alta de cuenta.
 *
 * Tira `CustomerError` con un mensaje que **sí** se le muestra a la persona: a
 * diferencia del login, acá "ese WhatsApp ya tiene cuenta" no filtra nada que
 * no se pueda averiguar igual intentando registrarse. Lo que no se puede es
 * confirmarlo desde el *login*, que es donde importa.
 */
export async function registerCustomer(
  input: {
    phone: string;
    password: string;
    name: string;
    email?: string | null;
    marketingOptIn?: boolean;
  },
  executor?: Executor
): Promise<Customer> {
  const tx = executor ?? getDb();

  const phone = normalizePhonePY(input.phone);
  if (!phone) throw new CustomerError("error.cuenta.telefono");

  const name = input.name.trim();
  if (name.length < 3) throw new CustomerError("error.cuenta.nombre");

  const email = input.email ? normalizeCustomerEmail(input.email) : null;
  const passwordHash = await hashPassword(input.password);

  const existing = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(
      email
        ? or(eq(customers.phone, phone), eq(customers.email, email))
        : eq(customers.phone, phone)
    )
    .limit(1);

  if (existing[0]) {
    throw new CustomerError("error.cuenta.yaExiste");
  }

  await tx.insert(customers).values({
    phone,
    email,
    passwordHash,
    name,
    // Tres estados como en `orders`: si no se preguntó, queda NULL.
    marketingOptIn: input.marketingOptIn ?? null,
    marketingOptInAt: input.marketingOptIn === undefined ? null : sql`NOW()`,
  });

  const created = await findCustomerByPhone(phone, tx);
  if (!created) throw new CustomerError("error.cuenta.noPude");
  return created;
}

export async function findCustomerByPhone(
  phone: string,
  executor?: Executor
): Promise<Customer | null> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select()
    .from(customers)
    .where(eq(customers.phone, phone))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    phone: row.phone,
    email: row.email,
    name: row.name,
    marketingOptIn: row.marketingOptIn,
    phoneVerifiedAt: row.phoneVerifiedAt,
    sessionVersion: row.sessionVersion,
    hasPassword: row.passwordHash !== null,
  };
}

export async function findCustomerById(
  id: number,
  executor?: Executor
): Promise<Customer | null> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select()
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || !row.isActive) return null;
  return {
    id: row.id,
    phone: row.phone,
    email: row.email,
    name: row.name,
    marketingOptIn: row.marketingOptIn,
    phoneVerifiedAt: row.phoneVerifiedAt,
    sessionVersion: row.sessionVersion,
    hasPassword: row.passwordHash !== null,
  };
}

/**
 * Login de cliente: **teléfono O email**, más contraseña.
 *
 * Devuelve `null` en cualquier fallo y sin distinguir el motivo — no existe,
 * contraseña incorrecta y cuenta desactivada son el mismo `null` hacia afuera.
 * `verifyPassword` corre un hash señuelo cuando no hay usuario, así que el
 * tiempo de respuesta tampoco delata la diferencia.
 *
 * `password_hash` NULL (una cuenta creada por OTP en el PR F) entra por el
 * mismo camino: `verifyPassword(_, null)` es false.
 */
export async function authenticateCustomer(
  identifier: string,
  password: string,
  executor?: Executor
): Promise<Customer | null> {
  const tx = executor ?? getDb();

  // El identificador puede ser un teléfono en cualquier formato o un email.
  const phone = normalizePhonePY(identifier);
  const email = identifier.includes("@")
    ? normalizeCustomerEmail(identifier)
    : null;
  if (!phone && !email) {
    // Igual corremos un bcrypt: salir antes convertiría un identificador mal
    // formado en una respuesta notablemente más rápida.
    await verifyPassword(password, null);
    return null;
  }

  const rows = await tx
    .select()
    .from(customers)
    .where(
      phone && email
        ? or(eq(customers.phone, phone), eq(customers.email, email))
        : phone
          ? eq(customers.phone, phone)
          : eq(customers.email, email!)
    )
    .limit(1);

  const row = rows[0];
  const ok = await verifyPassword(password, row?.passwordHash);
  if (!ok || !row || !row.isActive) return null;

  try {
    await tx
      .update(customers)
      .set({ lastLoginAt: sql`NOW()` })
      .where(eq(customers.id, row.id));
  } catch (error) {
    log.error("No pude registrar last_login_at del cliente", {
      error: mensajeDe(error),
    });
  }

  return {
    id: row.id,
    phone: row.phone,
    email: row.email,
    name: row.name,
    marketingOptIn: row.marketingOptIn,
    phoneVerifiedAt: row.phoneVerifiedAt,
    sessionVersion: row.sessionVersion,
    hasPassword: row.passwordHash !== null,
  };
}

/** Los datos que la persona puede cambiar de su propia cuenta. */
export async function updateCustomerProfile(
  customerId: number,
  input: { name: string; email?: string | null; marketingOptIn: boolean },
  executor?: Executor
): Promise<void> {
  const tx = executor ?? getDb();

  const name = input.name.trim();
  if (name.length < 3) throw new CustomerError("error.cuenta.nombre");

  const email = input.email ? normalizeCustomerEmail(input.email) : null;

  if (email) {
    const taken = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, email))
      .limit(1);
    if (taken[0] && taken[0].id !== customerId) {
      throw new CustomerError("error.cuenta.emailUsado");
    }
  }

  // El teléfono **no** se cambia desde acá: es la llave de la cuenta y lo que
  // matchea los pedidos. Cambiarlo es una operación con verificación de por
  // medio, y todavía no hay con qué verificar (PR F).
  await tx
    .update(customers)
    .set({
      name,
      email,
      marketingOptIn: input.marketingOptIn,
      marketingOptInAt: sql`NOW()`,
    })
    .where(eq(customers.id, customerId));
}

export type CustomerOrderRow = {
  id: number;
  orderNumber: string;
  accessToken: string;
  status: OrderStatus;
  totalPyg: number;
  createdAt: Date;
  /** `false` = es un pedido viejo, atado a la cuenta sólo por el teléfono. */
  linked: boolean;
};

/**
 * Los pedidos de una cuenta.
 *
 * Dos fuentes, y la segunda tiene una condición que importa:
 *
 * 1. `orders.customer_id = ?` — los pedidos hechos con la sesión abierta.
 *    Siempre.
 * 2. Los pedidos viejos que matchean por teléfono — **sólo si el teléfono de
 *    la cuenta está verificado** (`phone_verified_at`).
 *
 * El plan pide "los pedidos viejos que matcheen el teléfono verificado de la
 * cuenta", y esa palabra es toda la diferencia: sin verificación, cualquiera
 * que se registre tipeando el WhatsApp de otra persona ve el historial de
 * compras de esa persona, con nombre, dirección y el token de acceso de cada
 * pedido. En esta fase no hay proveedor de mensajería, así que
 * `phone_verified_at` es siempre NULL y este camino **no devuelve nada**. El
 * PR F (OTP por WhatsApp) es el que lo enciende.
 */
export async function listCustomerOrders(
  customerId: number,
  executor?: Executor
): Promise<CustomerOrderRow[]> {
  const tx = executor ?? getDb();

  const account = await tx
    .select({
      phone: customers.phone,
      phoneVerifiedAt: customers.phoneVerifiedAt,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  const me = account[0];
  if (!me) return [];

  const linkedToMe = eq(orders.customerId, customerId);
  const where = me.phoneVerifiedAt
    ? or(
        linkedToMe,
        and(isNull(orders.customerId), eq(orders.customerPhone, me.phone))
      )
    : linkedToMe;

  const rows = await tx
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      accessToken: orders.accessToken,
      status: orders.status,
      totalPyg: orders.totalPyg,
      createdAt: orders.createdAt,
      customerId: orders.customerId,
    })
    .from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(100);

  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    accessToken: row.accessToken,
    status: row.status,
    totalPyg: row.totalPyg,
    createdAt: row.createdAt,
    linked: row.customerId !== null,
  }));
}

/**
 * Atar un pedido de invitado a una cuenta, después del hecho.
 *
 * Es el "¿querés guardar tus datos?" que aparece al terminar la compra. Sólo
 * ata pedidos que todavía no tienen dueño **y** cuyo teléfono es el de la
 * cuenta: sin las dos condiciones esto sería una forma de adoptar el pedido de
 * cualquiera conociendo su número.
 */
export async function claimGuestOrder(
  customerId: number,
  orderNumber: string,
  accessToken: string,
  executor?: Executor
): Promise<boolean> {
  const tx = executor ?? getDb();

  const account = await tx
    .select({ isActive: customers.isActive })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const me = account[0];
  if (!me?.isActive || !accessToken) return false;
  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  if (!order || order.customerId !== null) return false;
  const supplied = Buffer.from(accessToken);
  const expected = Buffer.from(order.accessToken);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return false;

  const result = await tx
    .update(orders)
    .set({ customerId })
    .where(
      and(
        eq(orders.orderNumber, orderNumber),
        isNull(orders.customerId),
        eq(orders.accessToken, accessToken)
      )
    );

  // mysql2 devuelve `affectedRows` en el header del resultado.
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number })?.affectedRows ?? 0) > 0;
}

/** Para el panel: qué compradores tienen cuenta, por teléfono. */
export async function customersByPhone(
  phones: readonly string[],
  executor?: Executor
): Promise<Map<string, { marketingOptIn: boolean | null; createdAt: Date }>> {
  if (phones.length === 0) return new Map();
  const tx = executor ?? getDb();

  const rows = await tx
    .select({
      phone: customers.phone,
      marketingOptIn: customers.marketingOptIn,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(sql`${customers.phone} IN ${phones}`);

  return new Map(
    rows.map((row) => [
      row.phone,
      { marketingOptIn: row.marketingOptIn, createdAt: row.createdAt },
    ])
  );
}

/** La lista de marketing: cuentas activas que dijeron que sí. Owner-only. */
export async function listMarketingOptIns(
  executor?: Executor
): Promise<
  Array<{ phone: string; email: string | null; name: string; since: Date }>
> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select({
      phone: customers.phone,
      email: customers.email,
      name: customers.name,
      since: customers.marketingOptInAt,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(
      and(
        eq(customers.isActive, true),
        eq(customers.marketingOptIn, true),
        isNotNull(customers.phone)
      )
    )
    .orderBy(desc(customers.createdAt));

  return rows.map((row) => ({
    phone: row.phone,
    email: row.email,
    name: row.name,
    since: row.since ?? row.createdAt,
  }));
}
