import { and, eq, gte, isNull, lte, ne } from 'drizzle-orm';

import { getDb } from '@/db';
import { orders } from '@/db/schema';
import { log, mensajeDe } from '@/lib/log';

import type { Executor } from './executor';
import { withTimeout } from './notify-timing';
import {
  customerNoticeBody,
  resolveCustomerNotifier,
  type CustomerNotifier,
} from './order-customer-notifications';
import { nombreTienda } from '@/lib/marca';

/**
 * El recordatorio de pago antes del vencimiento (plan-crecimiento §5.2).
 *
 * El agujero que tapa: un pedido de transferencia entra a las 9 de la mañana,
 * la compradora se distrae, y a las 9 de la noche el cron lo vence sin que
 * nadie le haya dicho nada. La mercadería vuelve al stock y la venta no
 * existió. Un solo mensaje cuando le quedan pocas horas es la diferencia entre
 * eso y un cobro.
 *
 * Las cuatro decisiones que lo hacen seguro:
 *
 * 1. **Uno solo por pedido, nunca dos.** La marca es una columna
 *    (`orders.payment_reminder_sent_at`) y se escribe **antes** de mandar, con
 *    `UPDATE ... WHERE payment_reminder_sent_at IS NULL`: sólo la corrida que
 *    ve `affectedRows = 1` manda el mensaje. Dos corridas del cron solapadas
 *    —o una que reintenta— no pueden mandarlo dos veces. Un envío que falla
 *    **queda marcado igual**: un recordatorio de menos es tolerable, dos son
 *    spam, y quien no recibió el mensaje sigue teniendo su pedido y su página.
 * 2. **Sin plantilla, apagado y sin consultar nada.** Misma regla que los
 *    otros avisos a la compradora: la plantilla de Meta es el interruptor, y
 *    una tienda que no la cargó no tiene que pagar ni una consulta por esto
 *    (`tests/unit/flags-apagados.test.ts`).
 * 3. **Después de vencer, nunca antes.** `runMaintenance` vence primero y
 *    recién después llama acá, así que un pedido que se venció en esta misma
 *    corrida jamás recibe un "podés pagar hasta las...".
 * 4. **Sólo `pendiente_pago`, excluyendo contra entrega.** Contra entrega sí
 *    pasa por ese estado y se excluye explícitamente porque no tiene nada que
 *    pagar antes de recibir. El aviso es para transferencia y tarjeta abandonada
 *    en Pagopar.
 */

/** Cuánto antes del vencimiento sale el aviso. */
export const REMINDER_WINDOW_HOURS = 6;

/** Cuántos por corrida: una tanda tiene que caber en un request del cron. */
export const REMINDER_BATCH = 50;

const AVISO_TIMEOUT_MS = 10_000;

export type PaymentReminderReport = {
  /** Pedidos que entraron en la ventana y estaban sin marcar. */
  candidatos: number;
  /** Mensajes que salieron bien. */
  enviados: number;
  /** Marcados pero cuyo envío falló. La diferencia queda en el log. */
  fallidos: number;
};

const NADA: PaymentReminderReport = { candidatos: 0, enviados: 0, fallidos: 0 };

/**
 * Les recuerda el pago a los pedidos que están por vencer. **No tira nunca.**
 *
 * Devuelve los tres conteos para el reporte del cron. Sin plantilla devuelve
 * ceros sin tocar la base.
 */
export async function sendPaymentReminders(
  now: Date = new Date(),
  options: { notifier?: CustomerNotifier | null; executor?: Executor } = {},
): Promise<PaymentReminderReport> {
  try {
    const notifier =
      options.notifier === undefined ? resolveCustomerNotifier('recordatorio') : options.notifier;
    if (!notifier) return NADA;

    const tx = options.executor ?? getDb();
    const limite = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 3600_000);

    const candidatos = await tx
      .select({
        orderId: orders.id,
        orderNumber: orders.orderNumber,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        accessToken: orders.accessToken,
        totalPyg: orders.totalPyg,
        reservedUntil: orders.reservedUntil,
      })
      .from(orders)
      .where(
        and(
          eq(orders.status, 'pendiente_pago'),
          ne(orders.paymentMethod, 'contra_entrega'),
          isNull(orders.paymentReminderSentAt),
          // La ventana se abre en `now` y no en el pasado a propósito: un
          // pedido cuya reserva ya venció es trabajo de `expireOverdueOrders`,
          // que corrió un renglón antes en la misma corrida.
          gte(orders.reservedUntil, now),
          lte(orders.reservedUntil, limite),
        ),
      )
      .orderBy(orders.reservedUntil)
      .limit(REMINDER_BATCH);

    if (candidatos.length === 0) return NADA;

    let enviados = 0;
    let fallidos = 0;
    let marcados = 0;

    for (const pedido of candidatos) {
      // Marcar primero. `affectedRows = 1` es la carrera ganada; 0 significa
      // que otra corrida ya se lo llevó y acá no se manda nada.
      const marca = await tx
        .update(orders)
        .set({ paymentReminderSentAt: now })
        .where(and(eq(orders.id, pedido.orderId), isNull(orders.paymentReminderSentAt)));
      if (affectedRows(marca) !== 1) continue;

      marcados += 1;

      try {
        await withTimeout(
          notifier.sender.send({
            to: pedido.customerPhone,
            body: customerNoticeBody('recordatorio', pedido, { tienda: await nombreTienda() }),
            templateName: notifier.templateName,
          }),
          AVISO_TIMEOUT_MS,
        );
        enviados += 1;
      } catch (error) {
        // El fallo **no** desmarca: ver la regla 1. Queda en el log con el
        // número de pedido, que es lo que el dueño necesita para llamar.
        fallidos += 1;
        log.error('sendPaymentReminders: no se pudo avisar', {
          pedido: pedido.orderNumber,
          error: mensajeDe(error),
        });
      }
    }

    return { candidatos: marcados, enviados, fallidos };
  } catch (error) {
    // Último cinturón: esto corre adentro del cron que vence pedidos, y un
    // recordatorio que explota no puede hacer fallar el vencimiento.
    log.error('sendPaymentReminders falló entero', { error: mensajeDe(error) });
    return NADA;
  }
}

/** mysql2 devuelve `[ResultSetHeader, FieldPacket[]]`: `affectedRows` va en el primero. */
function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}
