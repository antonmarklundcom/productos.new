import { timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { orderItems, orders, payments } from "@/db/schema";
import { normalizePhonePY } from "@/lib/py";

import type { Executor } from "./executor";

/**
 * Acceso del comprador a su pedido, sin cuenta de usuario (ARCH.md §1).
 *
 * La llave es el token de 32 bytes que va en el link de WhatsApp. Todo lo que
 * hay acá existe para que ese token no se pueda adivinar ni deducir del
 * tiempo de respuesta.
 */

/**
 * Comparación en tiempo constante.
 *
 * `timingSafeEqual` explota si los buffers tienen largos distintos —y ese
 * throw ya filtra el largo—, así que primero se comparan los largos y recién
 * después los bytes. Un `===` acá deja medir cuántos caracteres del token se
 * acertaron.
 */
export function tokensMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type BuyerOrder = Awaited<ReturnType<typeof getOrderByNumber>>;

export async function getOrderByNumber(orderNumber: string, executor?: Executor) {
  const tx = executor ?? getDb();
  const rows = await tx
    .select()
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber.trim().toUpperCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function getOrderItems(orderId: number, executor?: Executor) {
  const tx = executor ?? getDb();
  return tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
}

/**
 * Guard de las rutas del comprador: número de pedido + token.
 *
 * Devuelve `null` tanto si el pedido no existe como si el token no coincide.
 * Quien llama muestra el mismo 404 en los dos casos — distinguirlos convierte
 * la página en un detector de números de pedido válidos.
 */
export async function requireOrderAccess(
  orderNumber: string,
  token: string | null | undefined,
  executor?: Executor
) {
  if (!token) return null;
  const order = await getOrderByNumber(orderNumber, executor);
  if (!order) return null;
  return tokensMatch(order.accessToken, token) ? order : null;
}

/**
 * Búsqueda por número + teléfono, para cuando el comprador perdió el link.
 *
 * El teléfono se normaliza antes de comparar: el mismo número escrito
 * `0981 123 456` o `+595981123456` tiene que entrar igual. El rate limit lo
 * pone la ruta (5 intentos / 15 min / IP).
 */
export async function findOrderByNumberAndPhone(
  orderNumber: string,
  phone: string,
  executor?: Executor
): Promise<{ orderNumber: string; accessToken: string } | null> {
  const normalized = normalizePhonePY(phone);
  if (!normalized) return null;

  const tx = executor ?? getDb();
  const rows = await tx
    .select({ orderNumber: orders.orderNumber, accessToken: orders.accessToken })
    .from(orders)
    .where(
      and(
        eq(orders.orderNumber, orderNumber.trim().toUpperCase()),
        eq(orders.customerPhone, normalized)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

/** URL tokenizada — la que se pega en WhatsApp. */
export function orderUrl(orderNumber: string, accessToken: string, baseUrl = ""): string {
  return `${baseUrl}/pedido/${orderNumber}?t=${accessToken}`;
}

/**
 * Ubica el pedido a partir del `hash_pedido` que Pagopar nos devuelve al
 * volver del pago (PLAN.md 5.5).
 *
 * No dice nada sobre si el pago se acreditó — eso lo decide únicamente el
 * webhook (ARCH.md §4). Esto sólo existe para poder mandar al comprador a la
 * URL tokenizada de su pedido; el estado real lo muestra esa página, con
 * polling.
 */
export async function getOrderByPagoparHash(hashPedido: string, executor?: Executor) {
  const trimmed = hashPedido.trim();
  if (trimmed === "") return null;

  const tx = executor ?? getDb();
  const rows = await tx
    .select({ orderNumber: orders.orderNumber, accessToken: orders.accessToken })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(payments.provider, "pagopar"), eq(payments.providerRef, trimmed)))
    .limit(1);

  return rows[0] ?? null;
}
