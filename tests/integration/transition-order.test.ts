import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { InvalidTransitionError, OrderNotFoundError, getOrderEvents, transitionOrder } from '@/domain/orders';
import { reserveStock } from '@/domain/stock';
import { stockReservations, variants } from '@/db/schema';
import { eq } from 'drizzle-orm';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder, createVariant, getOnHand, getStatus } from '../helpers/factories';

const inOneDay = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

describe.skipIf(!hasTestDb)('transitionOrder', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('mueve el pedido y deja la fila de auditoría', async () => {
    const orderId = await createOrder({ status: 'pendiente_pago' });

    const result = await transitionOrder(orderId, 'esperando_verificacion', 'buyer', 'subió comprobante');

    expect(result).toMatchObject({ from: 'pendiente_pago', to: 'esperando_verificacion', changed: true });
    expect(await getStatus(orderId)).toBe('esperando_verificacion');

    const events = await getOrderEvents(orderId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      fromStatus: 'pendiente_pago',
      toStatus: 'esperando_verificacion',
      actor: 'buyer',
      reason: 'subió comprobante',
    });
  });

  it('rechaza una arista que no está en la allow-list y no toca nada', async () => {
    const orderId = await createOrder({ status: 'enviado' });

    await expect(transitionOrder(orderId, 'pagado', 'webhook:pagopar')).rejects.toThrow(InvalidTransitionError);

    expect(await getStatus(orderId)).toBe('enviado');
    expect(await getOrderEvents(orderId)).toHaveLength(0);
  });

  it.each([
    ['entregado', 'pendiente_pago'],
    ['pagado', 'cancelado'],
    ['cancelado', 'pagado'],
    ['reembolsado', 'pagado'],
    ['pendiente_pago', 'entregado'],
  ] as const)('%s → %s es inválido', async (from, to) => {
    const orderId = await createOrder({ status: from });
    await expect(transitionOrder(orderId, to, 'admin:test')).rejects.toThrow(InvalidTransitionError);
    expect(await getStatus(orderId)).toBe(from);
  });

  /**
   * `vencido → pagado` sí es una arista válida desde la política del pago
   * tardío (ARCH.md §4.1): el cron vence el pedido y el aviso de Pagopar llega
   * un segundo después. Lo que la controla no es la tabla de aristas sino el
   * re-chequeo de stock — todo eso se prueba en `late-payment.test.ts`.
   * `cancelado → pagado`, en cambio, sigue prohibido: lo canceló una persona.
   */
  it('vencido → pagado es válido (recuperación del pago tardío)', async () => {
    const orderId = await createOrder({ status: 'vencido' });

    const result = await transitionOrder(orderId, 'pagado', 'pagopar', 'pago tardío');

    expect(result.changed).toBe(true);
    expect(await getStatus(orderId)).toBe('pagado');
  });

  it('explota si el pedido no existe', async () => {
    await expect(transitionOrder(999999, 'pagado', 'admin:test')).rejects.toThrow(OrderNotFoundError);
  });

  it('→ pagado descuenta on_hand exactamente una vez', async () => {
    const variantId = await createVariant({ onHand: 10 });
    const orderId = await createOrder({ status: 'pendiente_pago' });
    await reserveStock(orderId, [{ variantId, qty: 3 }], { expiresAt: inOneDay() });

    // Reservar no toca el stock físico: sólo lo "esconde" de la disponibilidad.
    expect(await getOnHand(variantId)).toBe(10);

    const first = await transitionOrder(orderId, 'pagado', 'admin:test');
    expect(first.changed).toBe(true);
    expect(await getOnHand(variantId)).toBe(7);

    // Webhook repetido: mismo estado destino → no-op, sin segundo descuento.
    const second = await transitionOrder(orderId, 'pagado', 'webhook:pagopar');
    expect(second.changed).toBe(false);
    expect(await getOnHand(variantId)).toBe(7);

    // Y sin segundo evento de auditoría.
    expect(await getOrderEvents(orderId)).toHaveLength(1);
  });

  it('→ pagado consume la reserva aunque el stock físico haya bajado', async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 2 });
    const orderId = await createOrder({ status: 'pendiente_pago' });
    await reserveStock(orderId, [{ variantId, qty: 2 }], { expiresAt: inOneDay() });

    await db.update(variants).set({ onHand: 1 }).where(eq(variants.id, variantId));
    expect(await getOnHand(variantId)).toBe(1);

    await expect(transitionOrder(orderId, 'pagado', 'webhook:pagopar')).resolves.toMatchObject({
      changed: true,
    });

    expect(await getStatus(orderId)).toBe('pagado');
    expect(await getOnHand(variantId)).toBe(0);
    const reservations = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    expect(reservations.map((r) => r.state)).toEqual(['consumed']);
  });

  it('doble → pagado desde estados distintos tampoco descuenta dos veces', async () => {
    const variantId = await createVariant({ onHand: 5 });
    const orderId = await createOrder({ status: 'pendiente_pago' });
    await reserveStock(orderId, [{ variantId, qty: 2 }], { expiresAt: inOneDay() });

    await transitionOrder(orderId, 'esperando_verificacion', 'buyer');
    await transitionOrder(orderId, 'pagado', 'admin:test');
    expect(await getOnHand(variantId)).toBe(3);

    await transitionOrder(orderId, 'pagado', 'admin:test');
    expect(await getOnHand(variantId)).toBe(3);
  });

  it('→ pagado marca las reservas como consumidas y sella paid_at', async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 8 });
    const orderId = await createOrder({ status: 'pendiente_pago' });
    await reserveStock(orderId, [{ variantId, qty: 2 }], { expiresAt: inOneDay() });

    await transitionOrder(orderId, 'pagado', 'admin:test');

    const reservations = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    expect(reservations.map((r) => r.state)).toEqual(['consumed']);
  });

  it('→ vencido libera las reservas y deja el stock intacto', async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 6 });
    const orderId = await createOrder({ status: 'pendiente_pago' });
    await reserveStock(orderId, [{ variantId, qty: 4 }], { expiresAt: inOneDay() });

    await transitionOrder(orderId, 'vencido', 'cron:expirar');

    expect(await getOnHand(variantId)).toBe(6);
    const reservations = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    expect(reservations.map((r) => r.state)).toEqual(['released']);
  });

  it('→ cancelado también libera', async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 6 });
    const orderId = await createOrder({ status: 'pendiente_pago' });
    await reserveStock(orderId, [{ variantId, qty: 1 }], { expiresAt: inOneDay() });

    await transitionOrder(orderId, 'cancelado', 'admin:test', 'el cliente se arrepintió');

    const reservations = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    expect(reservations.map((r) => r.state)).toEqual(['released']);
  });

  it('rechazado permite reintentar el pago sin soltar el stock', async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 4 });
    const orderId = await createOrder({ status: 'esperando_verificacion' });
    await reserveStock(orderId, [{ variantId, qty: 2 }], { expiresAt: inOneDay() });

    await transitionOrder(orderId, 'rechazado', 'admin:test', 'comprobante ilegible');
    const reservations = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    expect(reservations.map((r) => r.state)).toEqual(['held']);

    expect(await getStatus(orderId)).toBe('rechazado');
    expect(await getOnHand(variantId)).toBe(4);
    await transitionOrder(orderId, 'esperando_verificacion', 'buyer', 'nuevo comprobante');
    expect(await getStatus(orderId)).toBe('esperando_verificacion');
    expect(await getOnHand(variantId)).toBe(4);
    await transitionOrder(orderId, 'pagado', 'admin:test');
    expect(await getStatus(orderId)).toBe('pagado');
    expect(await getOnHand(variantId)).toBe(2);
    await transitionOrder(orderId, 'pagado', 'admin:test');
    expect(await getOnHand(variantId)).toBe(2);
    const consumed = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    expect(consumed.map((r) => r.state)).toEqual(['consumed']);
  });

  it('el camino feliz completo queda registrado en orden', async () => {
    const orderId = await createOrder({ status: 'pendiente_pago' });
    for (const to of ['pagado', 'preparando', 'enviado', 'entregado'] as const) {
      await transitionOrder(orderId, to, 'admin:test');
    }
    const events = await getOrderEvents(orderId);
    expect(events.map((event) => event.toStatus)).toEqual(['pagado', 'preparando', 'enviado', 'entregado']);
    expect(await getStatus(orderId)).toBe('entregado');
  });

  it('dos → pagado concurrentes descuentan una sola vez', async () => {
    const variantId = await createVariant({ onHand: 10 });
    const orderId = await createOrder({ status: 'pendiente_pago' });
    await reserveStock(orderId, [{ variantId, qty: 3 }], { expiresAt: inOneDay() });

    // El SELECT ... FOR UPDATE serializa: una gana, la otra ve el estado final.
    const results = await Promise.allSettled([
      transitionOrder(orderId, 'pagado', 'webhook:pagopar'),
      transitionOrder(orderId, 'pagado', 'webhook:pagopar'),
    ]);

    const changed = results.filter((r) => r.status === 'fulfilled' && r.value.changed);
    expect(changed).toHaveLength(1);
    expect(await getOnHand(variantId)).toBe(7);
    expect(await getStatus(orderId)).toBe('pagado');
  });
});
