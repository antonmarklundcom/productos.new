import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { orderItems, orders, type OrderStatus } from '../../src/db/schema';
import { salesTrend, topProducts } from '../../src/domain/admin-dashboard';
import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder, createProduct, createVariant } from '../helpers/factories';

/**
 * Lo más vendido y la tendencia de la semana (PLAN.md 4.7).
 *
 * Igual que el resto del resumen, lo que se verifica es el criterio: sólo
 * entra lo cobrado y el día se corta a medianoche de Asunción.
 */
describe.skipIf(!hasTestDb)('resumen: top de productos y tendencia', () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  // Mediodía de Asunción del 7/8/2026.
  const AHORA = new Date('2026-08-07T15:00:00Z');

  async function sell(options: {
    variantId: number;
    productName: string;
    qty: number;
    unitPricePyg: number;
    status?: OrderStatus;
    createdAt?: Date;
  }): Promise<number> {
    const db = getTestDb();
    const total = options.qty * options.unitPricePyg;
    const orderId = await createOrder({ status: options.status ?? 'pagado', totalPyg: total });
    await db.insert(orderItems).values({
      orderId,
      variantId: options.variantId,
      nameSnapshot: `${options.productName} — Único`,
      skuSnapshot: `SKU-${randomBytes(3).toString('hex')}`,
      unitPricePyg: options.unitPricePyg,
      qty: options.qty,
      ivaRate: 10,
      lineTotalPyg: total,
    });
    await db
      .update(orders)
      .set({ createdAt: options.createdAt ?? AHORA })
      .where(eq(orders.id, orderId));
    return orderId;
  }

  describe('topProducts', () => {
    it('ordena por unidades vendidas y agrupa las variantes del mismo producto', async () => {
      const corpino = await createProduct();
      const media = await createProduct();
      // Dos variantes del mismo producto: el top es por producto, no por talle.
      const talle90 = await createVariant({ onHand: 50, productId: corpino });
      const talle95 = await createVariant({ onHand: 50, productId: corpino });
      const unica = await createVariant({ onHand: 50, productId: media });

      await sell({ variantId: talle90, productName: 'Corpiño', qty: 3, unitPricePyg: 100_000 });
      await sell({ variantId: talle95, productName: 'Corpiño', qty: 2, unitPricePyg: 100_000 });
      await sell({ variantId: unica, productName: 'Media', qty: 4, unitPricePyg: 50_000 });

      const top = await topProducts(AHORA);

      expect(top).toHaveLength(2);
      expect(top[0]?.productId).toBe(corpino);
      expect(top[0]?.qty).toBe(5);
      expect(top[0]?.totalPyg).toBe(500_000);
      expect(top[1]?.productId).toBe(media);
    });

    it('sólo cuenta lo cobrado', async () => {
      const productId = await createProduct();
      const variantId = await createVariant({ onHand: 50, productId });

      await sell({ variantId, productName: 'Corpiño', qty: 1, unitPricePyg: 100_000 });
      // Estos no entran: todavía pueden vencer o ya se cayeron.
      await sell({
        variantId,
        productName: 'Corpiño',
        qty: 9,
        unitPricePyg: 100_000,
        status: 'pendiente_pago',
      });
      await sell({
        variantId,
        productName: 'Corpiño',
        qty: 9,
        unitPricePyg: 100_000,
        status: 'cancelado',
      });

      const top = await topProducts(AHORA);

      expect(top[0]?.qty).toBe(1);
    });

    it('no arrastra el mes anterior', async () => {
      const productId = await createProduct();
      const variantId = await createVariant({ onHand: 50, productId });

      await sell({
        variantId,
        productName: 'Corpiño',
        qty: 7,
        unitPricePyg: 10_000,
        createdAt: new Date('2026-07-31T20:00:00Z'),
      });

      expect(await topProducts(AHORA)).toEqual([]);
    });

    it('respeta el límite', async () => {
      for (let i = 0; i < 3; i += 1) {
        const productId = await createProduct();
        const variantId = await createVariant({ onHand: 50, productId });
        await sell({ variantId, productName: `P${i}`, qty: i + 1, unitPricePyg: 10_000 });
      }

      expect(await topProducts(AHORA, 2)).toHaveLength(2);
    });

    it('sin ventas devuelve una lista vacía y no explota', async () => {
      expect(await topProducts(AHORA)).toEqual([]);
    });
  });

  describe('salesTrend', () => {
    it('devuelve un punto por día, incluidos los que no vendieron', async () => {
      const trend = await salesTrend(AHORA);

      expect(trend).toHaveLength(7);
      expect(trend.every((day) => day.totalPyg === 0 && day.orders === 0)).toBe(true);
      // El último punto es hoy.
      expect(trend.at(-1)?.day.toISOString()).toBe('2026-08-07T03:00:00.000Z');
    });

    it('suma cada pedido en su día paraguayo', async () => {
      const db = getTestDb();
      const hoy = await createOrder({ status: 'pagado', totalPyg: 100_000 });
      const ayer = await createOrder({ status: 'pagado', totalPyg: 50_000 });
      await db.update(orders).set({ createdAt: AHORA }).where(eq(orders.id, hoy));
      await db
        .update(orders)
        .set({ createdAt: new Date('2026-08-06T15:00:00Z') })
        .where(eq(orders.id, ayer));

      const trend = await salesTrend(AHORA);

      expect(trend.at(-1)).toMatchObject({ totalPyg: 100_000, orders: 1 });
      expect(trend.at(-2)).toMatchObject({ totalPyg: 50_000, orders: 1 });
    });

    it('un pedido de las 21:00 de Asunción cuenta ese día y no el siguiente', async () => {
      // 2026-08-07T00:30Z = 21:30 del 6 en Asunción.
      const nocheDel6 = new Date('2026-08-07T00:30:00Z');
      const pedido = await createOrder({ status: 'pagado', totalPyg: 70_000 });
      await getTestDb()
        .update(orders)
        .set({ createdAt: nocheDel6 })
        .where(eq(orders.id, pedido));

      const trend = await salesTrend(AHORA);

      expect(trend.at(-1)?.totalPyg).toBe(0);
      expect(trend.at(-2)?.totalPyg).toBe(70_000);
    });

    it('sólo cuenta lo cobrado y no lo que puede vencer', async () => {
      const pendiente = await createOrder({ status: 'pendiente_pago', totalPyg: 999_000 });
      await getTestDb().update(orders).set({ createdAt: AHORA }).where(eq(orders.id, pendiente));

      const trend = await salesTrend(AHORA);

      expect(trend.at(-1)?.totalPyg).toBe(0);
    });

    it('deja afuera lo anterior al rango', async () => {
      const viejo = await createOrder({ status: 'pagado', totalPyg: 800_000 });
      await getTestDb()
        .update(orders)
        .set({ createdAt: new Date('2026-07-20T15:00:00Z') })
        .where(eq(orders.id, viejo));

      const trend = await salesTrend(AHORA);

      expect(trend.reduce((sum, day) => sum + day.totalPyg, 0)).toBe(0);
    });

    it('los montos grandes vuelven como enteros exactos', async () => {
      const db = getTestDb();
      for (let i = 0; i < 2; i += 1) {
        const id = await createOrder({ status: 'pagado', totalPyg: 1_500_000 });
        await db.update(orders).set({ createdAt: AHORA }).where(eq(orders.id, id));
      }

      const trend = await salesTrend(AHORA);

      expect(trend.at(-1)?.totalPyg).toBe(3_000_000);
      expect(Number.isInteger(trend.at(-1)?.totalPyg)).toBe(true);
    });
  });
});
