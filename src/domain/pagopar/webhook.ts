import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { orders, paymentEvents, payments, type OrderStatus } from "@/db/schema";

import { InvalidTransitionError, StockUnavailableError, transitionOrder } from "../orders";
import type { PagoparWebhookEvent } from "./protocol";

/**
 * Procesamiento del aviso de pago de Pagopar (PLAN.md 5.2, ARCH.md §4).
 *
 * El aviso puede llegar **antes** que el comprador vuelva del checkout y puede
 * llegar **muchas veces**. Las dos cosas se resuelven acá adentro:
 *
 *  1. `INSERT IGNORE` en `payment_events (provider, event_key)` — el índice
 *     único es la idempotencia; si no insertó nada, es un repetido y salimos,
 *  2. el pedido se ubica por `payments.provider_ref = hash_pedido`, la fila que
 *     dejó `startPagoparCheckout` antes de redirigir,
 *  3. se verifica que el monto coincida con `orders.total_pyg`,
 *  4. recién ahí `transitionOrder(→ pagado)`. Nunca un `UPDATE` directo: es lo
 *     que impide que un aviso tardío arrastre un pedido `enviado` de vuelta.
 *
 * Todo pasa en **una sola transacción**, incluido el `INSERT IGNORE`. Esto
 * importa: si el proceso muere después de registrar el evento pero antes de
 * mover el pedido, con dos transacciones el reintento de Pagopar vería el
 * evento ya registrado, lo trataría como repetido y el pedido quedaría cobrado
 * y sin marcar. Con una sola, o queda todo o no queda nada y el reintento
 * hace el trabajo.
 */

export const PAGOPAR_ACTOR = "pagopar";

export type WebhookOutcome =
  /** Aviso nuevo y aplicado. `changed: false` = el pedido ya estaba pagado. */
  | { kind: "aplicado"; orderId: number; orderNumber: string; changed: boolean }
  /** Ya lo habíamos procesado: no se toca nada. */
  | { kind: "repetido" }
  /** `pagado: false` — se deja registrado y listo. */
  | { kind: "no_pagado"; orderId: number; orderNumber: string }
  /** El pedido está en un estado que no admite el pago (p. ej. `enviado`). */
  | { kind: "estado_final"; orderId: number; orderNumber: string; status: OrderStatus }
  /**
   * Pago tardío que no se pudo recuperar: el pedido había vencido y la
   * mercadería se vendió mientras tanto. El pago queda cobrado y registrado,
   * el pedido sigue `vencido` y hay que devolver la plata (ARCH.md §4.1).
   */
  | { kind: "sin_stock"; orderId: number; orderNumber: string; status: OrderStatus };

/** No conocemos ese `hash_pedido`. */
export class UnknownPagoparOrderError extends Error {
  constructor() {
    super("no reconozco ese hash_pedido");
    this.name = "UnknownPagoparOrderError";
  }
}

/** El monto del aviso no es el total del pedido. */
export class PagoparAmountMismatchError extends Error {
  constructor(
    readonly orderNumber: string,
    readonly expectedPyg: number,
    readonly receivedPyg: number
  ) {
    super(`El monto del aviso no coincide con el total del pedido ${orderNumber}`);
    this.name = "PagoparAmountMismatchError";
  }
}

/**
 * Clave de idempotencia.
 *
 * Lleva el estado además del hash: si sólo fuera el `hash_pedido`, un primer
 * aviso de "no pagado" bloquearía para siempre el "pagado" que viene después y
 * el pedido nunca se cobraría. Con el estado adentro, un repetido exacto se
 * descarta y un cambio real de estado pasa.
 */
export function eventKey(event: PagoparWebhookEvent): string {
  return `${event.hashPedido}:${event.pagado ? "pagado" : "pendiente"}`;
}

export async function processPagoparWebhook(
  event: PagoparWebhookEvent
): Promise<WebhookOutcome> {
  return getDb().transaction(async (tx) => {
    // 1. Idempotencia. `INSERT IGNORE` se apoya en UNIQUE(provider, event_key).
    const inserted = await tx
      .insert(paymentEvents)
      .ignore()
      .values({ provider: "pagopar", eventKey: eventKey(event), payload: event.raw });

    if (affectedRows(inserted) === 0) {
      return { kind: "repetido" };
    }

    // 2. ¿De qué pedido habla? La fila la escribió startPagoparCheckout.
    const payment = (
      await tx
        .select({ id: payments.id, orderId: payments.orderId })
        .from(payments)
        .where(and(eq(payments.provider, "pagopar"), eq(payments.providerRef, event.hashPedido)))
        .limit(1)
    )[0];

    // Se tira para que la transacción vuelva atrás y el evento NO quede
    // registrado: si esto es una carrera con `iniciar-transaccion` (el aviso
    // llegó antes de que commitee la fila de payments), el reintento de
    // Pagopar tiene que poder procesarlo, y un evento ya guardado lo
    // descartaría como repetido.
    if (!payment) throw new UnknownPagoparOrderError();

    const order = (
      await tx
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          totalPyg: orders.totalPyg,
        })
        .from(orders)
        .where(eq(orders.id, payment.orderId))
        .for("update")
    )[0];

    if (!order) throw new UnknownPagoparOrderError();

    // 3. El monto, antes de tocar el pedido. Comparación de enteros: los dos
    //    lados son guaraníes enteros y nunca pasan por un float.
    if (event.montoPyg !== order.totalPyg) {
      throw new PagoparAmountMismatchError(order.orderNumber, order.totalPyg, event.montoPyg);
    }

    if (!event.pagado) {
      // Aviso de un pago que no prosperó. Queda el rastro en payment_events y
      // el pedido sigue su curso normal (lo vence el cron si nadie paga).
      return { kind: "no_pagado", orderId: order.id, orderNumber: order.orderNumber };
    }

    await tx
      .update(payments)
      .set({ status: "paid", rawPayload: event.raw })
      .where(eq(payments.id, payment.id));

    // 4. El único camino para cambiar el estado.
    //
    // Ojo con el orden: la fila de `payments` ya quedó en `paid` arriba, a
    // propósito. Si esto falla —el pedido venció y no hay stock, o ya está
    // `cancelado`— el `catch` devuelve un resultado en vez de tirar, así que
    // la transacción COMMITEA y el pago queda registrado igual. Es la regla
    // central de la política: la plata entró, el registro de que entró no se
    // pierde nunca, aunque el pedido no se pueda salvar (ARCH.md §4.1).
    try {
      const result = await transitionOrder(
        order.id,
        "pagado",
        PAGOPAR_ACTOR,
        order.status === "vencido"
          ? "pago tardío recuperado: llegó después del vencimiento y había stock"
          : "pago confirmado por Pagopar",
        { executor: tx }
      );
      return {
        kind: "aplicado",
        orderId: order.id,
        orderNumber: order.orderNumber,
        changed: result.changed,
      };
    } catch (error) {
      if (error instanceof StockUnavailableError) {
        // Pago tardío que no se pudo recuperar. No es un error de Pagopar y
        // reintentar no lo arregla: 200, el pago queda `paid`, el pedido
        // `vencido`, y la fila aparece en "pagos sin pedido vivo" del panel
        // hasta que el dueño devuelva.
        return {
          kind: "sin_stock",
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
        };
      }

      if (!(error instanceof InvalidTransitionError)) throw error;

      // El pedido ya avanzó más allá de `pagado` (`enviado`, `entregado`) o
      // está en un estado que no admite cobro (`cancelado`). No es un error de
      // Pagopar y reintentar no lo arregla: se registra el evento, se deja el
      // pedido como está y se contesta 200 para que no entre en un bucle de
      // reintentos. El caso raro —plata para un pedido cancelado— queda en el
      // log y en payment_events para que el dueño lo vea.
      return {
        kind: "estado_final",
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
      };
    }
  });
}

/**
 * Corre `work` con un tope de tiempo.
 *
 * El trabajo sigue en segundo plano si se pasa: no se puede cancelar una
 * transacción de MySQL a mitad de camino y fingir que no ocurrió. Que eso sea
 * seguro no lo da el corte sino la atomicidad — o la transacción entera
 * commitea (y el reintento de Pagopar la ve repetida) o vuelve atrás (y el
 * reintento la rehace).
 */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new PagoparDeadlineError(ms)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export class PagoparDeadlineError extends Error {
  constructor(readonly ms: number) {
    super(`el procesamiento del aviso se pasó de ${ms} ms`);
    this.name = "PagoparDeadlineError";
  }
}

/** mysql2 devuelve `affectedRows`; drizzle lo pasa en el primer elemento. */
function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number })?.affectedRows ?? 0);
}
