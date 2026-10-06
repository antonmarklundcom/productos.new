import { and, eq, gt, lte, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  orderEvents,
  orderItems,
  orders,
  stockReservations,
  variants,
  type OrderStatus,
} from "@/db/schema";

import type { Executor, Tx } from "./executor";
import { recordManualPayment } from "./manual-payments";
import { type CustomerNoticeKind } from "./order-customer-notifications";
import { enqueueOrderNotice, kickOrderNotices } from "./notification-outbox";

/**
 * Máquina de estados del pedido (ARCH.md §3).
 *
 * `transitionOrder()` es la ÚNICA forma de cambiar `orders.status`. Ninguna
 * ruta, acción o script hace `UPDATE orders SET status = ...` por su cuenta:
 * si lo hiciera, un webhook duplicado o tardío podría arrastrar un pedido
 * `enviado` de vuelta a `pagado` y el log de auditoría mentiría.
 */
export const ORDER_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  pendiente_pago: ["esperando_verificacion", "pagado", "vencido", "cancelado"],
  esperando_verificacion: ["pagado", "rechazado", "cancelado"],
  // Reintento de comprobante, dar por cobrado desde el panel, vencimiento por cron o cancelación.
  rechazado: ["esperando_verificacion", "pagado", "vencido", "cancelado"],
  pagado: ["preparando", "reembolsado"],
  preparando: ["enviado", "reembolsado"],
  // Devolución total de un pedido ya despachado; el stock no vuelve solo:
  // la mercadería devuelta se repone con un ajuste de stock manual, auditado.
  enviado: ["entregado", "reembolsado"],
  entregado: ["reembolsado"],
  // `vencido → pagado` es la recuperación del pago tardío (ARCH.md §4.1): el
  // cron venció el pedido y el aviso de Pagopar llegó un segundo después. La
  // arista existe, pero entrar a `pagado` re-asegura el stock primero, así que
  // sólo revive el pedido si la mercadería sigue estando.
  vencido: ["pagado", "cancelado"],
  // `cancelado` NO revive: lo canceló una persona a propósito. Si entra plata
  // para un pedido cancelado, el pago queda registrado y va a la lista de
  // "pagos sin pedido vivo" para que el dueño devuelva.
  cancelado: [],
  reembolsado: [],
};

/** Estados en los que todavía no entró plata. */
export const PRE_PAYMENT_STATUSES: readonly OrderStatus[] = [
  "pendiente_pago",
  "esperando_verificacion",
  "rechazado",
];

/** Al entrar acá el stock se consume de verdad. */
const CONSUMES_STOCK: readonly OrderStatus[] = ["pagado"];
/** Al entrar acá las reservas se sueltan. */
const RELEASES_STOCK: readonly OrderStatus[] = ["vencido", "cancelado"];

/**
 * A qué destino le corresponde avisarle a la compradora (fase O3).
 *
 * Entrar a `pagado` cubre los tres caminos por los que llega la plata
 * (transferencia aprobada, Pagopar, contra entrega confirmada): los tres
 * pasan por acá, así que un solo mapeo alcanza para los tres sin tocar cada
 * llamador. `enviado` sólo se entra desde el panel (`advanceOrder`).
 */
const CUSTOMER_NOTICE_FOR_STATUS: Partial<
  Record<OrderStatus, CustomerNoticeKind>
> = {
  pagado: "pagado",
  enviado: "enviado",
  // El pedido de reseña: recién con el paquete en la mano tiene sentido
  // preguntar "¿qué te pareció?" (ver `src/domain/reviews.ts`).
  entregado: "resena",
};

export class OrderNotFoundError extends Error {
  constructor(readonly orderId: number) {
    super(`No existe el pedido ${orderId}`);
    this.name = "OrderNotFoundError";
  }
}

/**
 * Se quiso cobrar un pedido cuya mercadería ya no está.
 *
 * Pasa en los dos sentidos del mismo problema: el pedido venció y se vendió lo
 * que tenía reservado, o la reserva se venció sola y todavía no pasó el cron.
 * El mensaje está escrito para el dueño, que es quien lo va a leer en el panel.
 */
export class StockUnavailableError extends Error {
  constructor(
    readonly orderId: number,
    readonly variantId: number,
    readonly needed: number,
    readonly available: number
  ) {
    super(
      `Ya no hay stock para completar este pedido: faltan ${needed - available} ` +
        `unidad(es) de una de las variantes. Si el pago entró, hay que devolverlo.`
    );
    this.name = "StockUnavailableError";
  }
}

/**
 * Se mandó seguimiento del envío en una transición que no es `→ enviado`.
 *
 * Es un error de programación, no de la persona del panel, y por eso frena en
 * vez de ignorar el dato: aceptarlo en silencio dejaría la guía escrita en un
 * pedido `preparando` —o peor, en uno `cancelado`— y la compradora recibiría
 * después el aviso de envío con el número de otra cosa.
 */
export class TrackingNotAllowedError extends Error {
  constructor(
    readonly orderId: number,
    readonly to: OrderStatus
  ) {
    super(
      `El seguimiento del envío sólo se puede cargar al despachar, no al pasar a "${to}".`
    );
    this.name = "TrackingNotAllowedError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly orderId: number,
    readonly from: OrderStatus,
    readonly to: OrderStatus
  ) {
    super(`Transición inválida para el pedido ${orderId}: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export type TransitionResult = {
  orderId: number;
  from: OrderStatus;
  to: OrderStatus;
  /** `false` cuando el pedido ya estaba en ese estado (webhook repetido). */
  changed: boolean;
};

export type TransitionOptions = {
  /** Para encadenar la transición dentro de una transacción ya abierta. */
  executor?: Executor;
  /**
   * `users.id` de quien la disparó, cuando fue una persona del panel (PR D).
   *
   * Va en las opciones y no como parámetro posicional a propósito: la mayoría
   * de las transiciones **no** tienen usuario detrás —el cron que vence, el
   * webhook de Pagopar, la compradora que sube el comprobante— y volverlo
   * obligatorio empujaría a pasar un id inventado con tal de compilar, que es
   * exactamente la mentira que este PR existe para evitar.
   *
   * `actor` (el string) sigue siendo obligatorio y no cambia.
   */
  actorUserId?: number | null;
  /**
   * Seguimiento del envío, **sólo** con `to === 'enviado'` (plan-operacion
   * §5.1). Cualquier otro destino con esto puesto tira
   * `TrackingNotAllowedError`.
   *
   * Se escribe en `orders` en la misma transacción que el cambio de estado, y
   * no en un `UPDATE` posterior desde la acción: son la misma decisión del
   * mostrador —"esto salió, con este courier y esta guía"— y partirla en dos
   * escrituras crea el estado imposible de un pedido despachado sin guía
   * cuando la segunda falla.
   *
   * Los tres campos son opcionales entre sí: una moto propia despacha sin
   * número de guía, y un courier puede no dar link de seguimiento.
   */
  tracking?: OrderTracking;
};

/** Lo que el panel carga al despachar. Validado en `src/lib/schemas.ts`. */
export type OrderTracking = {
  carrier?: string | null;
  code?: string | null;
  url?: string | null;
};

/**
 * Los tres campos, normalizados para el UPDATE: `""` y `undefined` entran como
 * NULL. Sin esto, "despachar sin guía" dejaría la columna en cadena vacía y
 * cada lector tendría que acordarse de tratarla como ausente.
 */
function trackingColumns(tracking: OrderTracking) {
  const limpio = (valor: string | null | undefined): string | null =>
    valor?.trim() || null;
  return {
    trackingCarrier: limpio(tracking.carrier),
    trackingCode: limpio(tracking.code),
    trackingUrl: limpio(tracking.url),
  };
}

/**
 * Cambia el estado de un pedido.
 *
 * 1. abre transacción y toma `SELECT ... FOR UPDATE` sobre el pedido,
 * 2. si ya está en el estado destino, no hace nada (idempotente),
 * 3. rechaza toda arista que no esté en `ORDER_TRANSITIONS`,
 * 4. `→ pagado`: consume las reservas y descuenta `on_hand` en la MISMA
 *    transacción — una sola vez, porque las reservas quedan `consumed`,
 * 5. `→ vencido | cancelado`: libera las reservas,
 * 6. escribe la fila de auditoría en `order_events`.
 */
export async function transitionOrder(
  orderId: number,
  to: OrderStatus,
  actor: string,
  reason?: string | null,
  options: TransitionOptions = {}
): Promise<TransitionResult> {
  // Antes de abrir nada: el seguimiento sólo tiene sentido al despachar. Se
  // chequea acá arriba y no adentro de la transacción porque no depende del
  // estado de la base — es la forma del llamado la que está mal.
  if (options.tracking && to !== "enviado") {
    throw new TrackingNotAllowedError(orderId, to);
  }

  const run = async (tx: Tx | Executor): Promise<TransitionResult> => {
    const locked = await tx
      .select({
        id: orders.id,
        status: orders.status,
        orderNumber: orders.orderNumber,
        paymentMethod: orders.paymentMethod,
        totalPyg: orders.totalPyg,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");

    const order = locked[0];
    if (!order) throw new OrderNotFoundError(orderId);

    const from = order.status;

    // Webhook repetido / doble click del admin: no-op, no evento, no descuento.
    if (from === to) {
      return { orderId, from, to, changed: false };
    }

    if (!canTransition(from, to)) {
      throw new InvalidTransitionError(orderId, from, to);
    }

    if (CONSUMES_STOCK.includes(to)) {
      // Antes de descontar: comprobar que la mercadería siga estando. Va acá
      // adentro y no en quien llama a propósito — es la única forma de que
      // NINGÚN camino a `pagado` (webhook, comprobante aprobado, botón del
      // panel) pueda descontar stock que ya no existe.
      await secureStockForPayment(tx, orderId);
      await consumeReservations(tx, orderId);

      // Y por la misma razón, el registro del cobro manual (TASKS.md §27). El
      // comprobante aprobado y el contra entrega confirmado son plata que
      // entró: si la fila de `payments` no se escribe acá, en la transacción
      // que cobra, no hay dónde escribirla después sin poder mentir.
      await recordManualPayment(tx, {
        id: orderId,
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
        totalPyg: order.totalPyg,
      });
    }
    if (RELEASES_STOCK.includes(to)) {
      await releaseReservations(tx, orderId);
    }

    await tx
      .update(orders)
      .set({
        status: to,
        ...(to === "pagado" ? { paidAt: new Date() } : {}),
        // El seguimiento viaja en este mismo UPDATE, dentro de la misma
        // transacción: o el pedido queda despachado con su guía, o no queda
        // despachado. Ver `TransitionOptions.tracking`.
        ...(options.tracking ? trackingColumns(options.tracking) : {}),
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, from)));

    await tx.insert(orderEvents).values({
      orderId,
      fromStatus: from,
      toStatus: to,
      actor,
      actorUserId: options.actorUserId ?? null,
      reason: reason ?? null,
    });

    const noticeKind = CUSTOMER_NOTICE_FOR_STATUS[to];
    if (noticeKind)
      await enqueueOrderNotice(
        tx,
        orderId,
        noticeKind,
        to,
        noticeKind === "enviado" ? reason : null
      );

    return { orderId, from, to, changed: true };
  };

  const result = await (options.executor
    ? run(options.executor)
    : getDb().transaction(run));

  // Caller-owned transactions are drained by the cron after commit.
  if (!options.executor && result.changed) kickOrderNotices(orderId);

  return result;
}

/**
 * Se asegura de que la mercadería del pedido siga estando, justo antes de
 * descontarla (ARCH.md §4.1).
 *
 * Cubre los dos lados de la misma carrera:
 *
 *  - **pago tardío**: el cron venció el pedido y liberó sus reservas; el aviso
 *    de Pagopar llega después. No queda ninguna reserva viva, así que hay que
 *    volver a tomarla — y si otro comprador se llevó la última unidad en el
 *    medio, no se toma nada y el pedido no revive.
 *  - **reserva vencida sin cron**: el pedido sigue en `pendiente_pago` con sus
 *    filas todavía en `held`, pero pasadas de `expires_at`. Descontar sobre
 *    esas filas sería descontar apoyándose en una promesa que ya expiró y que
 *    la vidriera dejó de contar hace rato: para el resto del mundo esa unidad
 *    estaba disponible. Se sueltan y se vuelven a pedir como cualquiera.
 *
 * Primero verifica **todas** las líneas y recién después escribe: si faltara
 * algo, no queda el pedido con media reserva nueva y media no.
 *
 * Un pedido sin ítems (dato roto, lo reporta `pnpm reconcile`) no tiene nada
 * que asegurar y se deja pasar: frenar acá el cobro de un pedido que ya tiene
 * la plata adentro sería el peor de los dos males.
 */
async function secureStockForPayment(
  tx: Executor,
  orderId: number
): Promise<void> {
  // Una reserva pasada de hora no reserva nada. Soltarla acá deja el conteo
  // de `held` vigentes igual a lo que ve la vidriera.
  await tx
    .update(stockReservations)
    .set({ state: "released" })
    .where(
      and(
        eq(stockReservations.orderId, orderId),
        eq(stockReservations.state, "held"),
        lte(stockReservations.expiresAt, sql`NOW()`)
      )
    );

  const needs = await tx
    .select({
      variantId: orderItems.variantId,
      qty: sql<string | number>`SUM(${orderItems.qty})`,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .groupBy(orderItems.variantId)
    // Mismo orden de locks que `reserveStock`, o dos pedidos con los mismos
    // ítems se deadlockean cruzados.
    .orderBy(orderItems.variantId);

  if (needs.length === 0) return;

  const missing: Array<{ variantId: number; qty: number }> = [];

  for (const need of needs) {
    const wanted = Number(need.qty);

    const locked = await tx
      .select({ onHand: variants.onHand })
      .from(variants)
      .where(eq(variants.id, need.variantId))
      .for("update");

    const onHand = locked[0]?.onHand ?? 0;

    // Lectura bloqueante, no un SUM común: en REPEATABLE READ un SELECT normal
    // lee del snapshot y no vería la reserva que el comprador rival acaba de
    // commitear (misma razón que en `stock.ts`).
    const live = await tx
      .select({
        orderId: stockReservations.orderId,
        qty: stockReservations.qty,
      })
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.variantId, need.variantId),
          eq(stockReservations.state, "held"),
          gt(stockReservations.expiresAt, sql`NOW()`)
        )
      )
      .for("update");

    let own = 0;
    let others = 0;
    for (const row of live) {
      if (row.orderId === orderId) own += row.qty;
      else others += row.qty;
    }

    const shortfall = wanted - own;
    if (shortfall <= 0) continue;

    const free = onHand - others - own;
    if (shortfall > free) {
      throw new StockUnavailableError(
        orderId,
        need.variantId,
        wanted,
        own + Math.max(0, free)
      );
    }

    missing.push({ variantId: need.variantId, qty: shortfall });
  }

  // Reservas nuevas para lo que faltaba. Nacen `held` y las consume el paso
  // siguiente en esta misma transacción, así que el `expires_at` no llega a
  // significar nada — se pone en el futuro sólo para que ninguna consulta de
  // disponibilidad las ignore mientras tanto.
  const expiresAt = new Date(Date.now() + RECOVERY_HOLD_MINUTES * 60_000);
  for (const item of missing) {
    await tx.insert(stockReservations).values({
      variantId: item.variantId,
      orderId,
      qty: item.qty,
      expiresAt,
      state: "held",
    });
  }
}

/** Vida de la reserva que se toma al recuperar un pago tardío. */
const RECOVERY_HOLD_MINUTES = 15;

/**
 * Marca las reservas del pedido como `consumed` y descuenta `on_hand`.
 * Sólo toca las que siguen en `held`, así que correr esto dos veces descuenta
 * una sola vez.
 */
async function consumeReservations(
  tx: Executor,
  orderId: number
): Promise<void> {
  const held = await tx
    .select({
      id: stockReservations.id,
      variantId: stockReservations.variantId,
      qty: stockReservations.qty,
    })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.orderId, orderId),
        eq(stockReservations.state, "held")
      )
    )
    .for("update");

  for (const reservation of held) {
    await tx
      .update(variants)
      // on_hand es UNSIGNED: GREATEST solo no alcanza porque la resta se evalúa
      // antes y puede fallar. Casteamos a SIGNED para dejar 0 si un ajuste de
      // stock dejó menos de lo reservado, sin abortar el cobro.
      .set({
        onHand: sql`GREATEST(CAST(${variants.onHand} AS SIGNED) - ${reservation.qty}, 0)`,
      })
      .where(eq(variants.id, reservation.variantId));

    await tx
      .update(stockReservations)
      .set({ state: "consumed" })
      .where(
        and(
          eq(stockReservations.id, reservation.id),
          eq(stockReservations.state, "held")
        )
      );
  }
}

async function releaseReservations(
  tx: Executor,
  orderId: number
): Promise<void> {
  await tx
    .update(stockReservations)
    .set({ state: "released" })
    .where(
      and(
        eq(stockReservations.orderId, orderId),
        eq(stockReservations.state, "held")
      )
    );
}

/** Timeline del pedido para `/pedido/[n]` y para el admin. */
export async function getOrderEvents(orderId: number, executor?: Executor) {
  const tx = executor ?? getDb();
  return tx
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(orderEvents.createdAt, orderEvents.id);
}
