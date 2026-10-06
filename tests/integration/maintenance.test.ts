import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { orderEvents, orders, stockReservations } from '../../src/db/schema';
import {
  collectStaleReservations,
  expireOverdueOrders,
  releaseOrphanReservations,
  runMaintenance,
} from '../../src/domain/maintenance';
import { reserveStock } from '../../src/domain/stock';
import { getAvailability } from '../../src/domain/stock';
import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder, createVariant, getOnHand, getStatus } from '../helpers/factories';

const HOUR = 3600_000;

/** Tareas del cron (PLAN.md 4.8). */
describe.skipIf(!hasTestDb)('expireOverdueOrders', () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function overdueOrder(options: { reservedUntil: Date; status?: 'pendiente_pago' | 'pagado' | 'rechazado' }) {
    const db = getTestDb();
    const orderId = await createOrder({ status: options.status ?? 'pendiente_pago' });
    await db
      .update(orders)
      .set({ reservedUntil: options.reservedUntil })
      .where(eq(orders.id, orderId));
    return orderId;
  }

  it('vence los pedidos sin pago que pasaron su reserva', async () => {
    const vencido = await overdueOrder({ reservedUntil: new Date(Date.now() - HOUR) });
    const vigente = await overdueOrder({ reservedUntil: new Date(Date.now() + HOUR) });

    const result = await expireOverdueOrders();

    expect(result.expired).toEqual([vencido]);
    expect(await getStatus(vencido)).toBe('vencido');
    expect(await getStatus(vigente)).toBe('pendiente_pago');
  });

  it('libera el stock reservado al vencer', async () => {
    const variantId = await createVariant({ onHand: 10 });
    const orderId = await overdueOrder({ reservedUntil: new Date(Date.now() - HOUR) });

    await reserveStock(orderId, [{ variantId, qty: 4 }], {
      expiresAt: new Date(Date.now() + HOUR),
    });
    expect(await getAvailability(variantId)).toBe(6);

    await expireOverdueOrders();

    const db = getTestDb();
    const rows = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    expect(rows.map((row) => row.state)).toEqual(['released']);

    // Vencer no descuenta stock físico: nunca entró plata.
    expect(await getOnHand(variantId)).toBe(10);
    expect(await getAvailability(variantId)).toBe(10);
  });

  it('vence un pedido rechazado fuera de plazo y libera su reserva', async () => {
    const variantId = await createVariant({ onHand: 10 });
    const orderId = await overdueOrder({
      reservedUntil: new Date(Date.now() - HOUR), status: 'rechazado',
    });
    const vigente = await overdueOrder({
      reservedUntil: new Date(Date.now() + HOUR), status: 'rechazado',
    });
    await reserveStock(orderId, [{ variantId, qty: 4 }], {
      expiresAt: new Date(Date.now() + HOUR),
    });
    expect(await getAvailability(variantId)).toBe(6);

    const result = await expireOverdueOrders();
    expect(result.expired).toEqual([orderId]);
    expect(await getStatus(orderId)).toBe('vencido');
    expect(await getStatus(vigente)).toBe('rechazado');
    const rows = await getTestDb().select().from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    expect(rows.map((row) => row.state)).toEqual(['released']);
    expect(await getOnHand(variantId)).toBe(10);
    expect(await getAvailability(variantId)).toBe(10);
  });

  it('nunca toca un pedido ya pagado, aunque su reserva esté vencida', async () => {
    const pagado = await overdueOrder({
      reservedUntil: new Date(Date.now() - 48 * HOUR),
      status: 'pagado',
    });

    const result = await expireOverdueOrders();

    expect(result.expired).toEqual([]);
    expect(await getStatus(pagado)).toBe('pagado');
  });

  it('ignora los pedidos sin reserved_until', async () => {
    const sinReserva = await createOrder({ status: 'pendiente_pago' });

    const result = await expireOverdueOrders();

    expect(result.expired).toEqual([]);
    expect(await getStatus(sinReserva)).toBe('pendiente_pago');
  });

  it('deja la fila de auditoría con actor `cron`', async () => {
    const orderId = await overdueOrder({ reservedUntil: new Date(Date.now() - HOUR) });

    await expireOverdueOrders();

    const db = getTestDb();
    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId));
    const last = events.at(-1);
    expect(last?.toStatus).toBe('vencido');
    expect(last?.actor).toBe('cron');
    expect(last?.reason).toMatch(/sin pago/i);
  });

  it('correrlo dos veces no duplica eventos (es idempotente)', async () => {
    const orderId = await overdueOrder({ reservedUntil: new Date(Date.now() - HOUR) });

    await expireOverdueOrders();
    const second = await expireOverdueOrders();

    expect(second.expired).toEqual([]);

    const db = getTestDb();
    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId));
    expect(events.filter((event) => event.toStatus === 'vencido')).toHaveLength(1);
  });
});

describe.skipIf(!hasTestDb)('limpieza de reservas', () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('borra las reservas resueltas y viejas, y conserva las vigentes', async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 50 });
    const orderId = await createOrder();
    const viejo = new Date(Date.now() - 60 * 24 * HOUR);

    await db.insert(stockReservations).values([
      { variantId, orderId, qty: 1, expiresAt: viejo, state: 'consumed', createdAt: viejo },
      { variantId, orderId, qty: 1, expiresAt: viejo, state: 'released', createdAt: viejo },
      // Vieja pero todavía `held`: es la prueba de qué se le reservó a un
      // pedido que sigue vivo. No se toca.
      { variantId, orderId, qty: 1, expiresAt: viejo, state: 'held', createdAt: viejo },
      // Reciente: fuera de la ventana de GC.
      { variantId, orderId, qty: 1, expiresAt: new Date(Date.now() + HOUR), state: 'consumed' },
    ]);

    const deleted = await collectStaleReservations();

    expect(deleted).toBe(2);
    const left = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    expect(left.map((row) => row.state).sort()).toEqual(['consumed', 'held']);
  });

  it('libera reservas held que quedaron colgadas de un pedido cancelado', async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 10 });
    const orderId = await createOrder({ status: 'cancelado' });

    await db.insert(stockReservations).values({
      variantId,
      orderId,
      qty: 3,
      expiresAt: new Date(Date.now() + HOUR),
      state: 'held',
    });

    // Antes: la reserva huérfana descuenta disponibilidad de un pedido muerto.
    expect(await getAvailability(variantId)).toBe(7);

    const released = await releaseOrphanReservations();

    expect(released).toBe(1);
    expect(await getAvailability(variantId)).toBe(10);
  });

  it('runMaintenance corre las tres cosas y devuelve el resumen', async () => {
    const db = getTestDb();
    const orderId = await createOrder({ status: 'pendiente_pago' });
    await db
      .update(orders)
      .set({ reservedUntil: new Date(Date.now() - HOUR) })
      .where(eq(orders.id, orderId));

    const report = await runMaintenance();

    expect(report.expired).toEqual([orderId]);
    expect(report.skipped).toBe(0);
    expect(report.reservationsDeleted).toBe(0);
    expect(await getStatus(orderId)).toBe('vencido');
  });
});
