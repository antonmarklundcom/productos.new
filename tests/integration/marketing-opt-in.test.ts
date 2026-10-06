import { seedPaymentReadiness } from "../helpers/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { orders, shippingZones } from "@/db/schema";
import { createOrder, type CreateOrderInput } from "@/domain/create-order";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant } from "../helpers/factories";

/**
 * Consentimiento para novedades (PLAN.md — pedido de la tienda).
 *
 * Lo que se prueba acá no es la casilla sino los **tres** estados de la
 * columna: no se preguntó, dijo que no, aceptó. Es la distinción que no se
 * puede reconstruir después, y por eso la columna es nullable.
 */

function input(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    items: [],
    customerName: "Rosa Giménez",
    customerPhone: "0981 123 456",
    docType: "NINGUNO",
    isConsumidorFinal: true,
    shipCity: "Asunción",
    shipAddress: "Av. Mcal. López 1234",
    paymentMethod: "transferencia",
    ...overrides,
  };
}

async function readOrder(orderId: number) {
  const rows = await getTestDb()
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("pedido inexistente");
  return row;
}

describe.skipIf(!hasTestDb)("consentimiento de novedades", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
    await getTestDb()
      .insert(shippingZones)
      .values({
        slug: "asuncion",
        name: "Asunción",
        cities: ["Asunción"],
        pricePyg: 25000,
      });
  });
  afterAll(closeTestDb);

  it("sin respuesta queda NULL y sin fecha: no se preguntó no es un no", async () => {
    const variantId = await createVariant({ onHand: 3 });
    const created = await createOrder(
      input({ items: [{ variantId, qty: 1 }] })
    );

    const order = await readOrder(created.orderId);
    expect(order.marketingOptIn).toBeNull();
    expect(order.marketingOptInAt).toBeNull();
  });

  it("aceptó: guarda true con la fecha de cuando lo dijo", async () => {
    const variantId = await createVariant({ onHand: 3 });
    const before = Date.now();
    const created = await createOrder(
      input({ items: [{ variantId, qty: 1 }], marketingOptIn: true })
    );

    const order = await readOrder(created.orderId);
    expect(order.marketingOptIn).toBe(true);
    expect(order.marketingOptInAt).toBeInstanceOf(Date);
    // Sin fecha, un "sí" no prueba nada dentro de un año.
    expect(order.marketingOptInAt!.getTime()).toBeGreaterThanOrEqual(
      before - 60_000
    );
  });

  it("dijo que no: guarda false, también con fecha", async () => {
    const variantId = await createVariant({ onHand: 3 });
    const created = await createOrder(
      input({ items: [{ variantId, qty: 1 }], marketingOptIn: false })
    );

    const order = await readOrder(created.orderId);
    expect(order.marketingOptIn).toBe(false);
    expect(order.marketingOptInAt).toBeInstanceOf(Date);
  });
});
