import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { orders, stockReservations } from "@/db/schema";

import type { Executor } from "./executor";
import { InvalidTransitionError, transitionOrder } from "./orders";
import { sendPaymentReminders, type PaymentReminderReport } from "./payment-reminders";
import { purgeNotifiedStockAlerts } from "./stock-alerts";

/**
 * Tareas del cron (PLAN.md 4.8).
 *
 * Nada de esto es indispensable para que la tienda venda bien: la
 * disponibilidad se calcula en vivo (`on_hand − reservas vigentes y no
 * vencidas`), así que una reserva vencida deja de contar sola y un cron caído
 * no puede dejar stock varado (ARCH.md §2). Esto es prolijidad: cerrar los
 * pedidos que ya nadie va a pagar y no dejar crecer la tabla de reservas para
 * siempre.
 */

/** Se vencen los pedidos pendiente_pago y rechazado: todavía no entró plata. */
const EXPIRABLE = ['pendiente_pago', 'rechazado'] as const;

/** Cuánto se guardan las reservas ya resueltas antes de borrarlas. */
export const RESERVATION_GC_DAYS = 30;

export type ExpiryReport = {
  expired: number[];
  /** Pedidos que se saltearon porque alguien los movió en el medio. */
  skipped: number;
  reservationsDeleted: number;
  /** Suscripciones de aviso de stock ya avisadas y vencidas (O6). */
  stockAlertsPurged: number;
  /** Recordatorios de pago de esta corrida (O15). */
  paymentReminders: PaymentReminderReport;
};

/**
 * Vence los pedidos sin pago que pasaron su `reserved_until`.
 *
 * Va uno por uno y no con un `UPDATE ... WHERE` masivo a propósito: el estado
 * sólo se mueve por `transitionOrder`, que valida la arista, libera las
 * reservas y escribe la fila de auditoría. Un UPDATE en bloque sería más
 * rápido y dejaría el historial mintiendo.
 */
export async function expireOverdueOrders(
  now: Date = new Date(),
  executor?: Executor,
): Promise<{ expired: number[]; skipped: number }> {
  const tx = executor ?? getDb();

  const overdue = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        inArray(orders.status, [...EXPIRABLE]),
        isNotNull(orders.reservedUntil),
        lt(orders.reservedUntil, now),
      ),
    )
    // Cota por corrida: si el cron estuvo caído una semana, no se abren miles
    // de transacciones en un request que Hostinger va a cortar por timeout.
    // Lo que sobra se vence en la corrida siguiente.
    .limit(200);

  const expired: number[] = [];
  let skipped = 0;

  for (const order of overdue) {
    try {
      const result = await transitionOrder(order.id, "vencido", "cron", "venció sin pago");
      if (result.changed) expired.push(order.id);
      else skipped += 1;
    } catch (error) {
      // Carrera normal: entre el SELECT y el UPDATE el comprador pagó o el
      // dueño lo canceló. Se saltea y sigue — un pedido no puede frenar la
      // corrida entera.
      if (error instanceof InvalidTransitionError) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }

  return { expired, skipped };
}

/**
 * Borra las reservas ya resueltas (`consumed` / `released`) más viejas que
 * `RESERVATION_GC_DAYS`.
 *
 * Nunca toca una `held`, ni siquiera vencida: mientras el pedido siga vivo esa
 * fila es la prueba de qué se le reservó. Las vencidas ya no restan
 * disponibilidad, así que borrarlas no apura nada.
 */
export async function collectStaleReservations(
  now: Date = new Date(),
  executor?: Executor,
): Promise<number> {
  const tx = executor ?? getDb();
  const cutoff = new Date(now.getTime() - RESERVATION_GC_DAYS * 24 * 3600_000);

  const result = await tx
    .delete(stockReservations)
    .where(
      and(
        inArray(stockReservations.state, ["consumed", "released"]),
        lt(stockReservations.createdAt, cutoff),
      ),
    );

  // mysql2 devuelve `affectedRows`; drizzle lo pasa en el primer elemento.
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number })?.affectedRows ?? 0);
}

/**
 * Además libera las reservas `held` de pedidos que ya terminaron mal
 * (`vencido` / `cancelado`) y quedaron colgadas — normalmente no pasa, porque
 * `transitionOrder` las libera, pero una corrida interrumpida podría dejarlas.
 */
export async function releaseOrphanReservations(executor?: Executor): Promise<number> {
  const tx = executor ?? getDb();

  const result = await tx
    .update(stockReservations)
    .set({ state: "released" })
    .where(
      and(
        eq(stockReservations.state, "held"),
        sql`${stockReservations.orderId} IN (
          SELECT ${orders.id} FROM ${orders}
          WHERE ${orders.status} IN ('vencido', 'cancelado')
        )`,
      ),
    );

  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number })?.affectedRows ?? 0);
}

export async function runMaintenance(now: Date = new Date()): Promise<ExpiryReport> {
  const { expired, skipped } = await expireOverdueOrders(now);
  await releaseOrphanReservations();
  const reservationsDeleted = await collectStaleReservations(now);
  // Suscripciones de "avisame cuando haya stock" ya avisadas hace más de 90
  // días (O6). Sólo las avisadas: una sin avisar sigue siendo una promesa
  // pendiente, por vieja que sea.
  const stockAlertsPurged = await purgeNotifiedStockAlerts(now);
  // El recordatorio de pago va **después** de vencer (O15): así un pedido que
  // se venció en esta misma corrida nunca recibe un "podés pagar hasta las…".
  // No tira nunca y no agrega una entrada de cron: es el mismo cada 15 min.
  const paymentReminders = await sendPaymentReminders(now);

  return { expired, skipped, reservationsDeleted, stockAlertsPurged, paymentReminders };
}
