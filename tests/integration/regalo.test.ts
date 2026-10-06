import { seedPaymentReadiness } from "../helpers/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { orders, shippingZones } from "@/db/schema";
import { createOrder, type CreateOrderInput } from "@/domain/create-order";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant } from "../helpers/factories";

/**
 * "Es un regalo" — el dato que se mira al armar el paquete.
 *
 * Lo único con filo acá es qué pasa con la nota cuando el pedido no es un
 * regalo: si se guardara igual, destildar la casilla dejaría el mensaje viejo
 * colgado y alguien lo imprimiría en la tarjeta de otra compra.
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

describe.skipIf(!hasTestDb)("pedido para regalar", () => {
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

  it("por defecto no es un regalo y no hay nota", async () => {
    const variantId = await createVariant({ onHand: 3 });
    const created = await createOrder(
      input({ items: [{ variantId, qty: 1 }] })
    );

    const order = await readOrder(created.orderId);
    expect(order.isGift).toBe(false);
    expect(order.giftNote).toBeNull();
  });

  it("guarda la marca y el mensaje, sin espacios de más", async () => {
    const variantId = await createVariant({ onHand: 3 });
    const created = await createOrder(
      input({
        items: [{ variantId, qty: 1 }],
        isGift: true,
        giftNote: "  ¡Feliz cumple!  ",
      })
    );

    const order = await readOrder(created.orderId);
    expect(order.isGift).toBe(true);
    expect(order.giftNote).toBe("¡Feliz cumple!");
  });

  it("sin marcar el regalo, la nota se descarta", async () => {
    const variantId = await createVariant({ onHand: 3 });
    const created = await createOrder(
      input({
        items: [{ variantId, qty: 1 }],
        isGift: false,
        giftNote: "texto viejo",
      })
    );

    const order = await readOrder(created.orderId);
    expect(order.isGift).toBe(false);
    expect(order.giftNote).toBeNull();
  });

  it("regalo sin mensaje queda con la marca y la nota en NULL", async () => {
    const variantId = await createVariant({ onHand: 3 });
    const created = await createOrder(
      input({ items: [{ variantId, qty: 1 }], isGift: true, giftNote: "   " })
    );

    const order = await readOrder(created.orderId);
    expect(order.isGift).toBe(true);
    expect(order.giftNote).toBeNull();
  });
});
