import { seedPaymentReadiness } from "../helpers/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  orderEvents,
  orderItems,
  orders,
  shippingZones,
  stockReservations,
} from "@/db/schema";
import {
  CheckoutError,
  createOrder,
  type CreateOrderInput,
} from "@/domain/create-order";
import { getAvailability } from "@/domain/stock";
import { ivaIncluded } from "@/lib/money";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant, getOnHand, getStatus } from "../helpers/factories";

async function seedZone(
  overrides: Partial<typeof shippingZones.$inferInsert> = {}
) {
  await getTestDb()
    .insert(shippingZones)
    .values({
      slug: overrides.slug ?? "asuncion",
      name: overrides.name ?? "Asunción",
      cities: overrides.cities ?? ["Asunción"],
      pricePyg: overrides.pricePyg ?? 25000,
      freeThresholdPyg: overrides.freeThresholdPyg ?? 500000,
      position: overrides.position ?? 1,
    });
}

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

describe.skipIf(!hasTestDb)("createOrder", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
    await seedZone();
  });
  afterAll(closeTestDb);

  it("crea el pedido, sus ítems y las reservas en una sola transacción", async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 10, pricePyg: 110000 });

    const order = await createOrder(input({ items: [{ variantId, qty: 2 }] }));

    expect(order.orderNumber).toBe("PY-000001");
    expect(order.accessToken).toHaveLength(64);
    expect(order.subtotalPyg).toBe(220000);
    expect(order.shippingPyg).toBe(25000);
    expect(order.totalPyg).toBe(245000);

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.orderId));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      unitPricePyg: 110000,
      qty: 2,
      lineTotalPyg: 220000,
    });

    const holds = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, order.orderId));
    expect(holds).toHaveLength(1);
    expect(holds[0]?.state).toBe("held");

    // El stock físico no se toca hasta que se confirma el pago.
    expect(await getOnHand(variantId)).toBe(10);
    expect(await getAvailability(variantId)).toBe(8);
    expect(await getStatus(order.orderId)).toBe("pendiente_pago");
  });

  it("cobra el precio de la DB aunque el carrito diga otra cosa", async () => {
    const variantId = await createVariant({ onHand: 5, pricePyg: 333000 });
    const order = await createOrder(input({ items: [{ variantId, qty: 1 }] }));
    expect(order.subtotalPyg).toBe(333000);
  });

  it("desglosa el IVA por línea y suma el del flete", async () => {
    const variantId = await createVariant({ onHand: 5, pricePyg: 110000 });
    const order = await createOrder(input({ items: [{ variantId, qty: 3 }] }));

    // 330.000 de mercadería + 25.000 de envío, todo con IVA 10% incluido.
    expect(order.iva10Pyg).toBe(30000 + ivaIncluded(25000, 10));
    expect(order.iva5Pyg).toBe(0);
  });

  it("aplica el umbral de envío gratis", async () => {
    const variantId = await createVariant({ onHand: 5, pricePyg: 600000 });
    const order = await createOrder(input({ items: [{ variantId, qty: 1 }] }));
    expect(order.shippingPyg).toBe(0);
    expect(order.totalPyg).toBe(600000);
  });

  it("cobra la zona más cara si la ciudad no está en ninguna", async () => {
    await seedZone({
      slug: "interior",
      name: "Interior",
      cities: ["Encarnación"],
      pricePyg: 90000,
      position: 2,
    });
    const variantId = await createVariant({ onHand: 5, pricePyg: 100000 });

    const order = await createOrder(
      input({ items: [{ variantId, qty: 1 }], shipCity: "Pueblo Nuevo" })
    );
    expect(order.shippingPyg).toBe(90000);
  });

  it("ignora acentos y mayúsculas al buscar la ciudad", async () => {
    const variantId = await createVariant({ onHand: 5, pricePyg: 100000 });
    const order = await createOrder(
      input({ items: [{ variantId, qty: 1 }], shipCity: "asuncion" })
    );
    expect(order.shippingPyg).toBe(25000);
  });

  it("guarda el teléfono normalizado y el estado inicial en el log", async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 5 });
    const order = await createOrder(input({ items: [{ variantId, qty: 1 }] }));

    const row = (
      await db.select().from(orders).where(eq(orders.id, order.orderId))
    )[0];
    expect(row?.customerPhone).toBe("+595981123456");

    const events = await db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, order.orderId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      fromStatus: null,
      toStatus: "pendiente_pago",
      actor: "buyer",
    });
  });

  it("valida el RUC antes de tocar la base", async () => {
    const variantId = await createVariant({ onHand: 5 });
    await expect(
      createOrder(
        input({
          items: [{ variantId, qty: 1 }],
          docType: "RUC",
          docNumber: "80012345-6",
        })
      )
    ).rejects.toThrow(CheckoutError);

    expect(await getTestDb().select().from(orders)).toHaveLength(0);
  });

  it("rechaza teléfonos que no son paraguayos", async () => {
    const variantId = await createVariant({ onHand: 5 });
    await expect(
      createOrder(
        input({
          items: [{ variantId, qty: 1 }],
          customerPhone: "+5491112345678",
        })
      )
    ).rejects.toThrow(/paraguayo/);
  });

  it("no deja pedido a medias si un ítem se quedó sin stock", async () => {
    const db = getTestDb();
    const ok = await createVariant({ onHand: 5 });
    const gone = await createVariant({ onHand: 0 });

    await expect(
      createOrder(
        input({
          items: [
            { variantId: ok, qty: 1 },
            { variantId: gone, qty: 1 },
          ],
        })
      )
    ).rejects.toThrow(CheckoutError);

    expect(await db.select().from(orders)).toHaveLength(0);
    expect(await db.select().from(orderItems)).toHaveLength(0);
    expect(await db.select().from(stockReservations)).toHaveLength(0);
  });

  it("el vencimiento de la reserva depende del método de pago", async () => {
    const variantId = await createVariant({ onHand: 10 });
    const transferencia = await createOrder(
      input({ items: [{ variantId, qty: 1 }] })
    );
    const tarjeta = await createOrder(
      input({ items: [{ variantId, qty: 1 }], paymentMethod: "tarjeta" })
    );

    const hours = (date: Date) => (date.getTime() - Date.now()) / 3_600_000;
    expect(hours(transferencia.reservedUntil)).toBeGreaterThan(23);
    expect(hours(tarjeta.reservedUntil)).toBeLessThan(1);
  });

  it("dos compradores peleando por la última unidad: uno solo entra", async () => {
    const variantId = await createVariant({ onHand: 1, pricePyg: 100000 });

    const results = await Promise.allSettled([
      createOrder(input({ items: [{ variantId, qty: 1 }] })),
      createOrder(input({ items: [{ variantId, qty: 1 }] })),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await getAvailability(variantId)).toBe(0);
  });

  it("seis checkouts simultáneos sobre tres unidades: entran tres", async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 3, pricePyg: 100000 });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        createOrder(input({ items: [{ variantId, qty: 1 }] }))
      )
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await getAvailability(variantId)).toBe(0);
    // Y no quedaron pedidos huérfanos de los que fallaron.
    expect(await db.select().from(orders)).toHaveLength(3);
  });

  it("números de pedido consecutivos y tokens distintos", async () => {
    const variantId = await createVariant({ onHand: 10 });
    const first = await createOrder(input({ items: [{ variantId, qty: 1 }] }));
    const second = await createOrder(input({ items: [{ variantId, qty: 1 }] }));

    expect([first.orderNumber, second.orderNumber]).toEqual([
      "PY-000001",
      "PY-000002",
    ]);
    expect(first.accessToken).not.toBe(second.accessToken);
  });

  it("un carrito vacío no crea nada", async () => {
    await expect(createOrder(input({ items: [] }))).rejects.toThrow(/vacío/);
  });
});

/**
 * PR A.3: el `<Input>` del email por fin se renderiza, así que esta columna
 * dejó de estar siempre vacía. El test cubre las dos puntas del camino: que
 * un email tipeado llega a `orders.customer_email`, y que no ponerlo —el caso
 * normal, el campo es opcional— sigue guardando NULL y no un string vacío.
 */
describe.skipIf(!hasTestDb)("createOrder · email del comprador", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
    await seedZone();
  });
  afterAll(closeTestDb);

  it("persiste el email cuando el comprador lo completa", async () => {
    const variantId = await createVariant({ onHand: 5, pricePyg: 100000 });

    const order = await createOrder(
      input({
        items: [{ variantId, qty: 1 }],
        customerEmail: "rosa@ejemplo.com.py",
      })
    );

    const [row] = await getTestDb()
      .select({ email: orders.customerEmail })
      .from(orders)
      .where(eq(orders.id, order.orderId));

    expect(row?.email).toBe("rosa@ejemplo.com.py");
  });

  it("guarda NULL —no cadena vacía— cuando lo deja en blanco", async () => {
    const variantId = await createVariant({ onHand: 5, pricePyg: 100000 });

    const order = await createOrder(
      input({ items: [{ variantId, qty: 1 }], customerEmail: "" })
    );

    const [row] = await getTestDb()
      .select({ email: orders.customerEmail })
      .from(orders)
      .where(eq(orders.id, order.orderId));

    expect(row?.email).toBeNull();
  });
});
