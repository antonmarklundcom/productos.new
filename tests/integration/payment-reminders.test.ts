import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { orders } from '@/db/schema';
import type { MessageSender, OutgoingMessage } from '@/domain/messaging';
import { runMaintenance } from '@/domain/maintenance';
import type { CustomerNotifier } from '@/domain/order-customer-notifications';
import { sendPaymentReminders } from '@/domain/payment-reminders';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder, getStatus } from '../helpers/factories';

/**
 * El recordatorio de pago (plan-crecimiento §5.2).
 *
 * Lo que se fija acá es lo único que puede salir caro: que **nunca** se mande
 * dos veces, que un envío fallido no habilite un segundo intento, y que un
 * pedido ya vencido no reciba un "podés pagar hasta las…".
 */

const HOUR = 3600_000;

function fakeSender(behaviour: 'ok' | 'throw'): MessageSender & { sent: OutgoingMessage[] } {
  const sent: OutgoingMessage[] = [];
  return {
    channel: 'consola',
    label: 'test',
    sent,
    async send(message: OutgoingMessage): Promise<void> {
      sent.push(message);
      if (behaviour === 'throw') throw new Error('Meta devolvió 500');
    },
  };
}

function notifier(sender: MessageSender): CustomerNotifier {
  return { sender, templateName: 'cliente_recordatorio' };
}

describe.skipIf(!hasTestDb)('sendPaymentReminders', () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(closeTestDb);

  /** Un pedido sin pagar con `reserved_until` a `horas` de ahora. */
  async function pedidoPorVencer(horas: number, status: 'pendiente_pago' | 'pagado' = 'pendiente_pago') {
    const orderId = await createOrder({ status, totalPyg: 350_000 });
    await getTestDb()
      .update(orders)
      .set({ reservedUntil: new Date(Date.now() + horas * HOUR) })
      .where(eq(orders.id, orderId));
    return orderId;
  }

  async function marca(orderId: number): Promise<Date | null> {
    const fila = (
      await getTestDb()
        .select({ marca: orders.paymentReminderSentAt })
        .from(orders)
        .where(eq(orders.id, orderId))
    )[0];
    return fila?.marca ?? null;
  }

  it('avisa una sola vez, aunque el cron corra tres veces', async () => {
    const orderId = await pedidoPorVencer(5);
    const sender = fakeSender('ok');

    const primera = await sendPaymentReminders(new Date(), { notifier: notifier(sender) });
    expect(primera).toEqual({ candidatos: 1, enviados: 1, fallidos: 0 });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.templateName).toBe('cliente_recordatorio');
    expect(await marca(orderId)).not.toBeNull();

    await sendPaymentReminders(new Date(), { notifier: notifier(sender) });
    await sendPaymentReminders(new Date(), { notifier: notifier(sender) });

    expect(sender.sent).toHaveLength(1);
  });

  it('excluye contra entrega dentro de las 6 h, pero avisa y marca transferencia', async () => {
    const now = new Date();
    const reservedUntil = new Date(now.getTime() + 5 * HOUR);
    const contraEntrega = await createOrder({ paymentMethod: 'contra_entrega' });
    const transferencia = await createOrder({
      paymentMethod: 'transferencia',
      customerPhone: '+595971999999',
    });
    for (const orderId of [contraEntrega, transferencia]) {
      await getTestDb().update(orders).set({ reservedUntil }).where(eq(orders.id, orderId));
    }
    const sender = fakeSender('ok');

    const report = await sendPaymentReminders(now, { notifier: notifier(sender) });

    expect(report).toEqual({ candidatos: 1, enviados: 1, fallidos: 0 });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe('+595971999999');
    expect(await marca(contraEntrega)).toBeNull();
    expect(await marca(transferencia)).not.toBeNull();
  });

  it('un pedido con 10 h por delante todavía no recibe nada', async () => {
    const orderId = await pedidoPorVencer(10);
    const sender = fakeSender('ok');

    expect(await sendPaymentReminders(new Date(), { notifier: notifier(sender) })).toEqual({
      candidatos: 0,
      enviados: 0,
      fallidos: 0,
    });
    expect(sender.sent).toEqual([]);
    expect(await marca(orderId)).toBeNull();
  });

  it('un pedido ya vencido en esta misma corrida no recibe recordatorio', async () => {
    // Con la plantilla puesta, `runMaintenance` resuelve el sender de consola y
    // hace el trabajo de verdad. Vence primero y avisa después: cuando le toca
    // el turno al recordatorio, este pedido ya no está en `pendiente_pago`.
    vi.stubEnv('WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RECORDATORIO', 'cliente_recordatorio');

    const vencido = await pedidoPorVencer(-1);
    const porVencer = await pedidoPorVencer(3);

    const report = await runMaintenance(new Date());

    expect(report.expired).toContain(vencido);
    expect(await getStatus(vencido)).toBe('vencido');
    expect(await marca(vencido)).toBeNull();

    // Y el que todavía puede pagar sí lo recibe, en la misma corrida.
    expect(report.paymentReminders).toEqual({ candidatos: 1, enviados: 1, fallidos: 0 });
    expect(await marca(porVencer)).not.toBeNull();
  });

  it('un pedido que no está esperando plata no recibe recordatorio', async () => {
    const orderId = await pedidoPorVencer(3, 'pagado');
    const sender = fakeSender('ok');

    await sendPaymentReminders(new Date(), { notifier: notifier(sender) });

    expect(sender.sent).toEqual([]);
    expect(await marca(orderId)).toBeNull();
  });

  it('si el envío falla, el pedido queda marcado igual y no se reintenta', async () => {
    const orderId = await pedidoPorVencer(2);
    const roto = fakeSender('throw');

    const report = await sendPaymentReminders(new Date(), { notifier: notifier(roto) });

    expect(report).toEqual({ candidatos: 1, enviados: 0, fallidos: 1 });
    // Un recordatorio de menos es tolerable; dos son spam.
    expect(await marca(orderId)).not.toBeNull();

    const sano = fakeSender('ok');
    await sendPaymentReminders(new Date(), { notifier: notifier(sano) });
    expect(sano.sent).toEqual([]);
  });

  it('sin plantilla no se marca nada ni se manda nada', async () => {
    const orderId = await pedidoPorVencer(1);

    // `notifier: null` es exactamente lo que devuelve `resolveCustomerNotifier`
    // cuando la tienda no cargó `WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RECORDATORIO`.
    const report = await sendPaymentReminders(new Date(), { notifier: null });

    expect(report).toEqual({ candidatos: 0, enviados: 0, fallidos: 0 });
    expect(await marca(orderId)).toBeNull();
  });

  it('el aviso dice el número del pedido y hasta cuándo, sin datos de nadie más', async () => {
    await pedidoPorVencer(4);
    const otro = await pedidoPorVencer(4);
    await getTestDb()
      .update(orders)
      .set({ customerPhone: '+595971999999', customerName: 'Otra Persona' })
      .where(eq(orders.id, otro));

    const sender = fakeSender('ok');
    await sendPaymentReminders(new Date(), { notifier: notifier(sender) });

    expect(sender.sent).toHaveLength(2);
    for (const mensaje of sender.sent) {
      expect(mensaje.body).toMatch(/PY-/);
      // Cada mensaje lleva un solo teléfono: el del destinatario, y en el `to`,
      // nunca en el cuerpo.
      expect(mensaje.body).not.toContain('+595971999999');
    }
  });

  it('una tienda sin la plantilla corre el cron exactamente como antes', async () => {
    const orderId = await pedidoPorVencer(5);

    // Sin plantilla, `runMaintenance` no manda nada, no marca nada y el reporte
    // lo dice con ceros: es el estado de toda tienda que no pidió esta
    // plantilla, y tiene que seguir siendo el de antes de O15.
    const report = await runMaintenance(new Date());

    expect(report.paymentReminders).toEqual({ candidatos: 0, enviados: 0, fallidos: 0 });
    expect(await marca(orderId)).toBeNull();
  });
});
