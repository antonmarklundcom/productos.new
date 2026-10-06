import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  orderEvents,
  orderItems,
  orderReturnItems,
  orderReturns,
  stockAdjustments,
  stockAlerts,
  type OrderStatus,
} from '@/db/schema';
import { findImpossibleEdges } from '@/domain/reconciliation';
import {
  RETURN_REASON_PREFIX,
  listRecentReturns,
  listReturnsForOrder,
  registerReturn,
  returnableQuantities,
} from '@/domain/returns';
import { subscribeStockAlert } from '@/domain/stock-alerts';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createAdminUser, createOrder, createVariant, getOnHand } from '../helpers/factories';

/**
 * Devoluciones de mercadería (`src/domain/returns.ts`).
 *
 * Lo que fijan estos tests: sólo de pedidos que salieron, nunca más de lo que
 * se vendió (sumando devoluciones anteriores), y reponer es un ajuste de stock
 * auditado con su aviso de "volvió el stock". La plata no aparece en ningún
 * lado: es el reembolso, aparte.
 */

async function lineaDePedido(orderId: number, variantId: number, qty: number, name = 'Remera — M') {
  const [result] = await getTestDb().insert(orderItems).values({
    orderId,
    variantId,
    nameSnapshot: name,
    skuSnapshot: `SKU-${variantId}`,
    unitPricePyg: 100_000,
    qty,
    ivaRate: 10,
    lineTotalPyg: 100_000 * qty,
  });
  return Number(result.insertId);
}

async function pedidoCon(status: OrderStatus, qty = 3, onHand = 5) {
  const variantId = await createVariant({ onHand });
  const orderId = await createOrder({ status });
  const orderItemId = await lineaDePedido(orderId, variantId, qty);
  return { orderId, variantId, orderItemId };
}

const ACTOR = 'admin:due@tienda.py';

describe.skipIf(!hasTestDb)('devoluciones de mercadería', () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await resetTables();
  });
  afterAll(closeTestDb);

  it.each(['pendiente_pago', 'pagado', 'preparando', 'cancelado', 'vencido'] as const)(
    'con el pedido en %s no se registra',
    async (status) => {
      const { orderId, orderItemId } = await pedidoCon(status);

      await expect(
        registerReturn({ orderId, reason: 'cambio de talle', items: [{ orderItemId, qty: 1, restock: true }], actor: ACTOR }),
      ).rejects.toMatchObject({ code: 'error.devolucion.estado' });
      expect(await getTestDb().select().from(orderReturns)).toHaveLength(0);
    },
  );

  it.each(['enviado', 'entregado', 'reembolsado'] as const)('con el pedido en %s sí', async (status) => {
    const { orderId, orderItemId } = await pedidoCon(status);

    const result = await registerReturn({
      orderId,
      reason: 'cambio de talle',
      items: [{ orderItemId, qty: 1, restock: false }],
      actor: ACTOR,
    });
    expect(result.returnId).toBeGreaterThan(0);
  });

  it('no se devuelve más de lo vendido, contando las devoluciones anteriores', async () => {
    const { orderId, orderItemId } = await pedidoCon('entregado', 3);

    await expect(
      registerReturn({ orderId, reason: 'de más', items: [{ orderItemId, qty: 4, restock: true }], actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'error.devolucion.demasiado' });

    await registerReturn({ orderId, reason: 'primera', items: [{ orderItemId, qty: 2, restock: true }], actor: ACTOR });
    await expect(
      registerReturn({ orderId, reason: 'segunda', items: [{ orderItemId, qty: 2, restock: true }], actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'error.devolucion.demasiado', params: { queda: 1 } });

    await registerReturn({ orderId, reason: 'segunda', items: [{ orderItemId, qty: 1, restock: false }], actor: ACTOR });
    expect(await returnableQuantities(orderId)).toEqual([
      { orderItemId, name: 'Remera — M', ordered: 3, returned: 3, remaining: 0 },
    ]);
    await expect(
      registerReturn({ orderId, reason: 'tercera', items: [{ orderItemId, qty: 1, restock: false }], actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'error.devolucion.demasiado', params: { queda: 0 } });
  });

  it('la línea tiene que ser de ese pedido, la cantidad ≥ 1 y el motivo obligatorio', async () => {
    const { orderId, orderItemId } = await pedidoCon('entregado');
    const otro = await pedidoCon('entregado');

    await expect(
      registerReturn({ orderId, reason: 'ajena', items: [{ orderItemId: otro.orderItemId, qty: 1, restock: true }], actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'error.devolucion.lineaAjena' });
    await expect(
      registerReturn({ orderId, reason: 'cero', items: [{ orderItemId, qty: 0, restock: true }], actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'error.devolucion.cantidad' });
    await expect(
      registerReturn({ orderId, reason: '  ', items: [{ orderItemId, qty: 1, restock: true }], actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'error.devolucion.sinMotivo' });
    await expect(
      registerReturn({ orderId, reason: 'nada', items: [], actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'error.devolucion.sinItems' });
  });

  it('reponer sube on_hand y deja su fila en stock_adjustments; no reponer no toca nada', async () => {
    const userId = await createAdminUser({ email: 'due@tienda.py' });
    const variantId = await createVariant({ onHand: 5 });
    const otraVariante = await createVariant({ onHand: 7 });
    const orderId = await createOrder({ status: 'entregado' });
    const vuelve = await lineaDePedido(orderId, variantId, 2, 'Remera — M');
    const noVuelve = await lineaDePedido(orderId, otraVariante, 1, 'Short — S');

    const result = await registerReturn({
      orderId,
      reason: 'talle equivocado',
      items: [
        { orderItemId: vuelve, qty: 2, restock: true },
        { orderItemId: noVuelve, qty: 1, restock: false },
      ],
      actor: ACTOR,
      actorUserId: userId,
    });

    expect(result.restockedUnits).toBe(2);
    expect(await getOnHand(variantId)).toBe(7);
    expect(await getOnHand(otraVariante)).toBe(7);

    const ajustes = await getTestDb().select().from(stockAdjustments);
    expect(ajustes).toHaveLength(1);
    expect(ajustes[0]).toMatchObject({
      variantId,
      delta: 2,
      previousOnHand: 5,
      newOnHand: 7,
      actor: ACTOR,
      actorUserId: userId,
    });
    expect(ajustes[0]?.reason).toMatch(/^Devolución del pedido PY-T[0-9A-F]+: talle equivocado$/);

    const lineas = await getTestDb()
      .select()
      .from(orderReturnItems)
      .where(eq(orderReturnItems.returnId, result.returnId));
    expect(lineas.map((linea) => [linea.orderItemId, linea.variantId, linea.qty, linea.restocked])).toEqual([
      [vuelve, variantId, 2, true],
      [noVuelve, otraVariante, 1, false],
    ]);

    const [vista] = await listReturnsForOrder(orderId);
    expect(vista).toMatchObject({
      reason: 'talle equivocado',
      actor: ACTOR,
      actorName: 'due@tienda.py',
      items: [
        { name: 'Remera — M', qty: 2, restocked: true },
        { name: 'Short — S', qty: 1, restocked: false },
      ],
    });
    expect((await listRecentReturns())[0]?.orderId).toBe(orderId);
  });

  it('deja un evento en el pedido sin cambiarle el estado, y reconcile no lo lee como arista', async () => {
    const { orderId, orderItemId } = await pedidoCon('entregado', 2);

    await registerReturn({ orderId, reason: 'no le gustó', items: [{ orderItemId, qty: 2, restock: true }], actor: ACTOR });

    const eventos = await getTestDb().select().from(orderEvents).where(eq(orderEvents.orderId, orderId));
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ fromStatus: 'entregado', toStatus: 'entregado', actor: ACTOR });
    expect(eventos[0]?.reason).toBe(
      `${RETURN_REASON_PREFIX}2× Remera — M (repuesto al stock). Motivo: no le gustó`,
    );

    expect(await findImpossibleEdges()).toEqual([]);
  });

  it('si la variante estaba agotada, reponerla dispara el aviso de "volvió el stock"', async () => {
    vi.stubEnv('WHATSAPP_CLOUD_TEMPLATE_STOCK_DISPONIBLE', 'stock_disponible');
    const { orderId, orderItemId, variantId } = await pedidoCon('entregado', 1, 0);
    await subscribeStockAlert({ variantId, phone: '+595981123456' });

    await registerReturn({ orderId, reason: 'cambio', items: [{ orderItemId, qty: 1, restock: true }], actor: ACTOR });

    // El disparo va sin `await` detrás del commit.
    await vi.waitFor(
      async () => {
        const [alerta] = await getTestDb().select().from(stockAlerts);
        expect(alerta?.notifiedAt).not.toBeNull();
      },
      { timeout: 2000, interval: 25 },
    );
  });

  it('sin reponer, una variante agotada sigue esperando y no se avisa', async () => {
    vi.stubEnv('WHATSAPP_CLOUD_TEMPLATE_STOCK_DISPONIBLE', 'stock_disponible');
    const { orderId, orderItemId, variantId } = await pedidoCon('entregado', 1, 0);
    await subscribeStockAlert({ variantId, phone: '+595981123456' });

    await registerReturn({ orderId, reason: 'fallada', items: [{ orderItemId, qty: 1, restock: false }], actor: ACTOR });
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

    const [alerta] = await getTestDb().select().from(stockAlerts);
    expect(alerta?.notifiedAt).toBeNull();
    expect(await getOnHand(variantId)).toBe(0);
  });
});
