import { seedPaymentReadiness } from "../helpers/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { orderItems, orders } from "../../src/db/schema";
import { createOrder as placeOrder } from "../../src/domain/create-order";
import {
  findLineMismatches,
  findTotalMismatches,
  reconcile,
} from "../../src/domain/reconciliation";
import { ivaIncluded } from "../../src/lib/money";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant } from "../helpers/factories";

/**
 * Query de reconciliación (PLAN.md 4.10).
 *
 * Es el control de caja: suma `order_items` y lo compara contra los totales
 * del pedido. Los tests hacen las dos mitades — que un pedido creado por el
 * camino normal cuadre, y que un descuadre inyectado a mano **se detecte**.
 * Un chequeo que nunca vio un caso malo no es un chequeo.
 */
describe.skipIf(!hasTestDb)("reconciliación de totales", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function realOrder(qty = 3, pricePyg = 33333) {
    const variantId = await createVariant({ onHand: 100, pricePyg });
    return placeOrder({
      items: [{ variantId, qty }],
      customerName: "Cliente de Prueba",
      customerPhone: "0981123456",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "transferencia",
    });
  }

  it("un pedido creado por createOrder cuadra", async () => {
    await realOrder();

    const report = await reconcile();
    expect(report.totalMismatches).toEqual([]);
    expect(report.lineMismatches).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("el IVA guardado es la suma por línea, no el redondeo del total", async () => {
    // Dos líneas de ₲ 33.333 al 10%.
    //   por línea:  round(33333 × 10/110) = 3030, dos veces  → 6060
    //   sobre el subtotal: round(66666 × 10/110)             → 6061
    // Un guaraní de diferencia contra la factura, todos los días.
    const primera = await createVariant({ onHand: 10, pricePyg: 33333 });
    const segunda = await createVariant({ onHand: 10, pricePyg: 33333 });

    const order = await placeOrder({
      items: [
        { variantId: primera, qty: 1 },
        { variantId: segunda, qty: 1 },
      ],
      customerName: "Cliente de Prueba",
      customerPhone: "0981123456",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "transferencia",
    });

    const db = getTestDb();
    const row = (
      await db.select().from(orders).where(eq(orders.id, order.orderId))
    )[0];
    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.orderId));

    const perLine = items.reduce(
      (sum, item) => sum + ivaIncluded(item.lineTotalPyg, item.ivaRate),
      0
    );
    const shippingIva = ivaIncluded(row?.shippingPyg ?? 0, 10);

    expect(row?.iva10Pyg).toBe(perLine + shippingIva);
    // Y no coincide con calcularlo sobre el subtotal de una: esa es la
    // diferencia que este test protege.
    expect(perLine).not.toBe(ivaIncluded(row?.subtotalPyg ?? 0, 10));
  });

  it("detecta un subtotal que no coincide con la suma de los ítems", async () => {
    const order = await realOrder();
    const db = getTestDb();

    // Se ensucia el subtotal a mano: es lo que dejaría un UPDATE hecho por
    // fuera de createOrder.
    await db
      .update(orders)
      .set({ subtotalPyg: order.subtotalPyg + 1000 })
      .where(eq(orders.id, order.orderId));

    const mismatches = await findTotalMismatches();
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.orderId).toBe(order.orderId);
    expect(mismatches[0]?.subtotalDiffPyg).toBe(1000);
  });

  it("detecta un total que no es subtotal + envío", async () => {
    const order = await realOrder();
    const db = getTestDb();

    await db
      .update(orders)
      .set({ totalPyg: order.totalPyg - 500 })
      .where(eq(orders.id, order.orderId));

    const mismatches = await findTotalMismatches();
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.totalDiffPyg).toBe(-500);
  });

  it("detecta una línea donde line_total ≠ precio × cantidad", async () => {
    const order = await realOrder();
    const db = getTestDb();

    const item = (
      await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.orderId))
        .limit(1)
    )[0];
    if (!item) throw new Error("el pedido no tiene ítems");

    await db
      .update(orderItems)
      .set({ lineTotalPyg: item.lineTotalPyg + 7 })
      .where(eq(orderItems.id, item.id));

    const mismatches = await findLineMismatches();
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.expectedLineTotalPyg).toBe(
      item.unitPricePyg * item.qty
    );
    expect(mismatches[0]?.storedLineTotalPyg).toBe(item.lineTotalPyg + 7);
  });

  it("un pedido sin ítems se reporta en vez de pasar desapercibido", async () => {
    const order = await realOrder();
    const db = getTestDb();

    await db.delete(orderItems).where(eq(orderItems.orderId, order.orderId));

    const mismatches = await findTotalMismatches();
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.itemsSubtotalPyg).toBe(0);
  });

  it("la query no pierde precisión con montos grandes", async () => {
    // ₲ 950.000.000 en una línea: bien adentro de BIGINT y bien afuera de lo
    // que un float representa exacto.
    const order = await realOrder(19, 50_000_000);

    const db = getTestDb();
    const [row] = await db
      .select({ total: sql<string>`CAST(${orders.totalPyg} AS CHAR)` })
      .from(orders)
      .where(eq(orders.id, order.orderId));

    expect(Number(row?.total)).toBe(order.totalPyg);
    expect(await findTotalMismatches()).toEqual([]);
    expect(await findLineMismatches()).toEqual([]);
  });
});
