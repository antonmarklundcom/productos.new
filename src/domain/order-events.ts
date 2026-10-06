import { getDb } from "@/db";
import { orderEvents, type OrderStatus } from "@/db/schema";

import type { Executor } from "./executor";

/** Prefijo de avisos sin transición; reconcile lo usa para reconocer sus eventos. */
export const NOTICE_REASON_PREFIX = "aviso_";

/**
 * La única forma de escribir en `order_events` fuera de `transitionOrder()`.
 *
 * `transitionOrder()` sigue siendo el único que mueve `orders.status` y escribe
 * su propio evento adentro de la misma transacción; eso no cambia. Esto es para
 * lo otro: lo que hay que dejar anotado en la historia del pedido **sin** que el
 * estado se mueva —el pedido recién creado, el aviso al dueño— y que antes se
 * escribía con un `insert` suelto en cada lugar.
 *
 * `toStatus` es NOT NULL en la tabla, así que un evento que no es una
 * transición guarda el estado en el que el pedido **sigue** estando y deja
 * `fromStatus` en null para la creación. Los avisos usan `fromStatus = status`
 * y `NOTICE_REASON_PREFIX` para distinguirlos de una transición.
 */
export type OrderEventInput = {
  orderId: number;
  /** El estado en el que queda el pedido; para un evento sin transición, el actual. */
  status: OrderStatus;
  /** Estado anterior; en avisos, igual a `status`. `null` por defecto al crear. */
  fromStatus?: OrderStatus | null;
  /** Quién: `"buyer"`, `"sistema"`, o el email de quien lo hizo desde el panel. */
  actor: string;
  /** La FK, sólo cuando lo movió una persona del panel (ver `order_events.actor_user_id`). */
  actorUserId?: number | null;
  /** Texto corto y sin datos de nadie: se lee en `/admin/actividad`. */
  reason?: string | null;
};

export async function recordOrderEvent(
  input: OrderEventInput,
  options: { executor?: Executor } = {},
): Promise<void> {
  const db = options.executor ?? getDb();
  await db.insert(orderEvents).values({
    orderId: input.orderId,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.status,
    actor: input.actor,
    actorUserId: input.actorUserId ?? null,
    reason: input.reason ?? null,
  });
}
