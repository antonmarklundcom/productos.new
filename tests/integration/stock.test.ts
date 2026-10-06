import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { stockReservations } from '@/db/schema';
import {
  InsufficientStockError,
  getAvailability,
  getAvailabilityMap,
  reservationExpiry,
  reserveStock,
} from '@/domain/stock';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder, createVariant, getOnHand } from '../helpers/factories';

const inOneDay = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

describe.skipIf(!hasTestDb)('getAvailability', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('sin reservas es el stock físico', async () => {
    const variantId = await createVariant({ onHand: 12 });
    expect(await getAvailability(variantId)).toBe(12);
  });

  it('descuenta las reservas vigentes', async () => {
    const variantId = await createVariant({ onHand: 12 });
    const orderId = await createOrder();
    await reserveStock(orderId, [{ variantId, qty: 5 }], { expiresAt: inOneDay() });

    expect(await getAvailability(variantId)).toBe(7);
    expect(await getOnHand(variantId)).toBe(12); // el stock físico no se movió
  });

  it('ignora las reservas vencidas — un cron caído no varía inventario', async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 12 });
    const orderId = await createOrder();
    await db.insert(stockReservations).values({
      variantId,
      orderId,
      qty: 9,
      expiresAt: anHourAgo(),
      state: 'held',
    });

    expect(await getAvailability(variantId)).toBe(12);
  });

  it('ignora las reservas consumidas o liberadas', async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 10 });
    const orderId = await createOrder();
    await db.insert(stockReservations).values([
      { variantId, orderId, qty: 3, expiresAt: inOneDay(), state: 'consumed' },
      { variantId, orderId, qty: 2, expiresAt: inOneDay(), state: 'released' },
    ]);

    expect(await getAvailability(variantId)).toBe(10);
  });

  it('una variante inexistente no tiene stock', async () => {
    expect(await getAvailability(999999)).toBe(0);
  });

  it('getAvailabilityMap resuelve varias variantes de una', async () => {
    const a = await createVariant({ onHand: 5 });
    const b = await createVariant({ onHand: 8 });
    const orderId = await createOrder();
    await reserveStock(orderId, [{ variantId: a, qty: 2 }], { expiresAt: inOneDay() });

    const map = await getAvailabilityMap([a, b]);
    expect(map.get(a)).toBe(3);
    expect(map.get(b)).toBe(8);
    expect(await getAvailabilityMap([])).toEqual(new Map());
  });
});

describe.skipIf(!hasTestDb)('reserveStock', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('reserva lo que hay', async () => {
    const variantId = await createVariant({ onHand: 4 });
    const orderId = await createOrder();

    await reserveStock(orderId, [{ variantId, qty: 4 }], { expiresAt: inOneDay() });
    expect(await getAvailability(variantId)).toBe(0);
  });

  it('rechaza pedir más de lo disponible', async () => {
    const variantId = await createVariant({ onHand: 2 });
    const orderId = await createOrder();

    await expect(
      reserveStock(orderId, [{ variantId, qty: 3 }], { expiresAt: inOneDay() }),
    ).rejects.toThrow(InsufficientStockError);
    expect(await getAvailability(variantId)).toBe(2);
  });

  it('es todo o nada: si un ítem no entra, no queda ninguna reserva', async () => {
    const db = getTestDb();
    const ok = await createVariant({ onHand: 10 });
    const short = await createVariant({ onHand: 1 });
    const orderId = await createOrder();

    await expect(
      reserveStock(
        orderId,
        [
          { variantId: ok, qty: 2 },
          { variantId: short, qty: 5 },
        ],
        { expiresAt: inOneDay() },
      ),
    ).rejects.toThrow(InsufficientStockError);

    const rows = await db.select().from(stockReservations).where(eq(stockReservations.orderId, orderId));
    expect(rows).toHaveLength(0);
    expect(await getAvailability(ok)).toBe(10);
  });

  it('no sobrevende cuando dos pedidos pelean por la última unidad', async () => {
    const variantId = await createVariant({ onHand: 1 });
    const orderA = await createOrder();
    const orderB = await createOrder();

    const results = await Promise.allSettled([
      reserveStock(orderA, [{ variantId, qty: 1 }], { expiresAt: inOneDay() }),
      reserveStock(orderB, [{ variantId, qty: 1 }], { expiresAt: inOneDay() }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await getAvailability(variantId)).toBe(0);
  });

  it('diez pedidos concurrentes sobre cinco unidades: exactamente cinco entran', async () => {
    const variantId = await createVariant({ onHand: 5 });
    const orderIds = await Promise.all(Array.from({ length: 10 }, () => createOrder()));

    const results = await Promise.allSettled(
      orderIds.map((orderId) => reserveStock(orderId, [{ variantId, qty: 1 }], { expiresAt: inOneDay() })),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(await getAvailability(variantId)).toBe(0);
  });

  it('rechaza cantidades inválidas', async () => {
    const variantId = await createVariant({ onHand: 5 });
    const orderId = await createOrder();
    await expect(reserveStock(orderId, [{ variantId, qty: 0 }], { expiresAt: inOneDay() })).rejects.toThrow(
      /qty inválida/,
    );
  });

  it('una lista vacía no hace nada', async () => {
    const orderId = await createOrder();
    expect(await reserveStock(orderId, [], { expiresAt: inOneDay() })).toEqual({ reserved: 0 });
  });
});

describe('reservationExpiry', () => {
  it('24 h para transferencia, 7 dias para contra entrega, 45 min para tarjeta', () => {
    const from = new Date('2026-03-01T12:00:00Z');
    expect(reservationExpiry('transferencia', from).toISOString()).toBe('2026-03-02T12:00:00.000Z');
    expect(reservationExpiry('contra_entrega', from).toISOString()).toBe('2026-03-08T12:00:00.000Z');
    expect(reservationExpiry('tarjeta', from).toISOString()).toBe('2026-03-01T12:45:00.000Z');
  });
});
