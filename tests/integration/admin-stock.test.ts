import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { stockAdjustments } from '../../src/db/schema';
import { adjustStock, listStockAdjustments, lowStockVariants } from '../../src/domain/admin-products';
import { reserveStock } from '../../src/domain/stock';
import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder, createVariant, getOnHand } from '../helpers/factories';

/**
 * Ajuste de stock auditado (PLAN.md 4.6).
 *
 * El punto del test no es que sume y reste: es que **no se pueda** mover el
 * stock sin dejar el motivo, y que la fila de auditoría guarde el antes y el
 * después.
 */
describe.skipIf(!hasTestDb)('adjustStock', () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('suma stock y deja el ajuste auditado con antes y después', async () => {
    const variantId = await createVariant({ onHand: 4 });

    const result = await adjustStock({
      variantId,
      delta: 6,
      reason: 'reposición del proveedor',
      actor: 'admin:due@tienda.py',
    });

    expect(result).toEqual({ previousOnHand: 4, newOnHand: 10 });
    expect(await getOnHand(variantId)).toBe(10);

    const [audit] = await listStockAdjustments(variantId);
    expect(audit).toMatchObject({
      variantId,
      delta: 6,
      previousOnHand: 4,
      newOnHand: 10,
      reason: 'reposición del proveedor',
      actor: 'admin:due@tienda.py',
    });
  });

  it('resta stock', async () => {
    const variantId = await createVariant({ onHand: 10 });

    await adjustStock({ variantId, delta: -3, reason: 'rotura en depósito', actor: 'admin:x' });

    expect(await getOnHand(variantId)).toBe(7);
  });

  it('sin motivo no hay ajuste', async () => {
    const variantId = await createVariant({ onHand: 5 });

    for (const reason of ['', '   ', 'ok']) {
      await expect(
        adjustStock({ variantId, delta: 1, reason, actor: 'admin:x' }),
      ).rejects.toThrow(/motivo/i);
    }

    expect(await getOnHand(variantId)).toBe(5);
    expect(await listStockAdjustments(variantId)).toEqual([]);
  });

  it('un ajuste de cero no tiene sentido y se rechaza', async () => {
    const variantId = await createVariant({ onHand: 5 });

    await expect(
      adjustStock({ variantId, delta: 0, reason: 'conteo mensual', actor: 'admin:x' }),
    ).rejects.toThrow(/distinto de cero/i);
  });

  it('no deja bajar el stock por debajo de cero', async () => {
    const variantId = await createVariant({ onHand: 2 });

    // `on_hand` es UNSIGNED: sin este corte, restar 5 daría un número
    // gigantesco en vez de un error.
    await expect(
      adjustStock({ variantId, delta: -5, reason: 'conteo de depósito', actor: 'admin:x' }),
    ).rejects.toThrow(/hay 2 en stock/i);

    expect(await getOnHand(variantId)).toBe(2);
    expect(await listStockAdjustments(variantId)).toEqual([]);
  });

  it('varios ajustes se acumulan y quedan todos en el historial', async () => {
    const variantId = await createVariant({ onHand: 0 });

    await adjustStock({ variantId, delta: 10, reason: 'carga inicial', actor: 'admin:x' });
    await adjustStock({ variantId, delta: -2, reason: 'muestra a vendedor', actor: 'admin:y' });
    await adjustStock({ variantId, delta: 5, reason: 'reposición', actor: 'admin:x' });

    expect(await getOnHand(variantId)).toBe(13);

    const db = getTestDb();
    const history = await db
      .select()
      .from(stockAdjustments)
      .where(eq(stockAdjustments.variantId, variantId))
      .orderBy(desc(stockAdjustments.id));

    expect(history).toHaveLength(3);
    // La cadena tiene que ser continua: el `newOnHand` de uno es el
    // `previousOnHand` del siguiente.
    const chronological = [...history].reverse();
    for (let i = 1; i < chronological.length; i += 1) {
      expect(chronological[i]?.previousOnHand).toBe(chronological[i - 1]?.newOnHand);
    }
  });

  it('una variante inexistente falla sin escribir nada', async () => {
    await expect(
      adjustStock({ variantId: 999_999, delta: 1, reason: 'lo que sea', actor: 'admin:x' }),
    ).rejects.toThrow(/no existe/i);
  });
});

describe.skipIf(!hasTestDb)('lowStockVariants', () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('mide sobre lo disponible, no sobre lo físico', async () => {
    const holgado = await createVariant({ onHand: 20 });
    const reservado = await createVariant({ onHand: 20 });

    // 18 de 20 reservados: quedan 2 para vender aunque el número físico se
    // vea sano. Es exactamente el caso que un "WHERE on_hand <= 3" no ve.
    const orderId = await createOrder();
    await reserveStock(orderId, [{ variantId: reservado, qty: 18 }], {
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const low = await lowStockVariants(3, 10);
    const ids = low.map((row) => row.variantId);

    expect(ids).toContain(reservado);
    expect(ids).not.toContain(holgado);
    expect(low.find((row) => row.variantId === reservado)?.available).toBe(2);
  });

  it('una reserva vencida vuelve a contar como disponible', async () => {
    const variantId = await createVariant({ onHand: 5 });
    const orderId = await createOrder();

    await reserveStock(orderId, [{ variantId, qty: 5 }], {
      expiresAt: new Date(Date.now() - 60_000),
    });

    const low = await lowStockVariants(3, 10);
    expect(low.map((row) => row.variantId)).not.toContain(variantId);
  });
});
