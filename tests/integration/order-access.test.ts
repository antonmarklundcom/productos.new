import { seedPaymentReadiness } from "../helpers/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  findOrderByNumberAndPhone,
  getOrderByNumber,
  orderUrl,
  requireOrderAccess,
  tokensMatch,
} from "@/domain/order-access";
import { createOrder } from "@/domain/create-order";
import { shippingZones } from "@/db/schema";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant } from "../helpers/factories";

async function makeOrder() {
  const variantId = await createVariant({ onHand: 5, pricePyg: 100000 });
  return createOrder({
    items: [{ variantId, qty: 1 }],
    customerName: "Rosa Giménez",
    customerPhone: "0981 123 456",
    docType: "NINGUNO",
    isConsumidorFinal: true,
    shipCity: "Asunción",
    shipAddress: "Av. Mcal. López 1234",
    paymentMethod: "transferencia",
  });
}

describe("tokensMatch", () => {
  it("acepta el token correcto", () => {
    const token = "a".repeat(64);
    expect(tokensMatch(token, token)).toBe(true);
  });

  it("rechaza uno distinto del mismo largo", () => {
    expect(tokensMatch("a".repeat(64), `${"a".repeat(63)}b`)).toBe(false);
  });

  it("rechaza largos distintos sin explotar", () => {
    // timingSafeEqual tira si los buffers difieren en largo: por eso se
    // compara el largo primero.
    expect(tokensMatch("a".repeat(64), "a")).toBe(false);
    expect(tokensMatch("a".repeat(64), "")).toBe(false);
    expect(tokensMatch("", "")).toBe(true);
  });

  it("no usa comparación por prefijo", () => {
    const real = "abcdef123456";
    expect(tokensMatch(real, "abcdef123457")).toBe(false);
    expect(tokensMatch(real, "abcdef")).toBe(false);
  });
});

describe("orderUrl", () => {
  it("arma la URL tokenizada que se pega en WhatsApp", () => {
    expect(orderUrl("PY-000123", "tok")).toBe("/pedido/PY-000123?t=tok");
    expect(orderUrl("PY-000123", "tok", "https://tienda.py")).toBe(
      "https://tienda.py/pedido/PY-000123?t=tok"
    );
  });
});

describe.skipIf(!hasTestDb)("requireOrderAccess", () => {
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
        position: 1,
      });
  });
  afterAll(closeTestDb);

  it("deja pasar con el token correcto", async () => {
    const created = await makeOrder();
    const order = await requireOrderAccess(
      created.orderNumber,
      created.accessToken
    );
    expect(order?.id).toBe(created.orderId);
  });

  it("rechaza sin token, con token vacío o con token ajeno", async () => {
    const created = await makeOrder();
    expect(await requireOrderAccess(created.orderNumber, null)).toBeNull();
    expect(await requireOrderAccess(created.orderNumber, "")).toBeNull();
    expect(
      await requireOrderAccess(created.orderNumber, "f".repeat(64))
    ).toBeNull();
  });

  it("un pedido inexistente y un token inválido son indistinguibles", async () => {
    const created = await makeOrder();
    const wrongToken = await requireOrderAccess(
      created.orderNumber,
      "f".repeat(64)
    );
    const noSuchOrder = await requireOrderAccess(
      "PY-999999",
      created.accessToken
    );
    expect(wrongToken).toBeNull();
    expect(noSuchOrder).toBeNull();
  });

  it("el número de pedido no distingue mayúsculas ni espacios", async () => {
    const created = await makeOrder();
    const found = await getOrderByNumber(
      `  ${created.orderNumber.toLowerCase()}  `
    );
    expect(found?.id).toBe(created.orderId);
  });
});

describe.skipIf(!hasTestDb)("findOrderByNumberAndPhone", () => {
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
        position: 1,
      });
  });
  afterAll(closeTestDb);

  it("encuentra el pedido con el teléfono escrito de cualquier forma", async () => {
    const created = await makeOrder();
    for (const phone of [
      "0981123456",
      "+595981123456",
      "981 123 456",
      "(0981) 123-456",
    ]) {
      const found = await findOrderByNumberAndPhone(created.orderNumber, phone);
      expect(found?.accessToken, phone).toBe(created.accessToken);
    }
  });

  it("no devuelve nada si el teléfono no coincide", async () => {
    const created = await makeOrder();
    expect(
      await findOrderByNumberAndPhone(created.orderNumber, "0982 000 000")
    ).toBeNull();
  });

  it("no devuelve nada con un número de pedido ajeno", async () => {
    const created = await makeOrder();
    expect(
      await findOrderByNumberAndPhone("PY-999999", "0981123456")
    ).toBeNull();
    expect(created.accessToken).toBeTruthy();
  });

  it("un teléfono con formato inválido no consulta la base", async () => {
    const created = await makeOrder();
    expect(
      await findOrderByNumberAndPhone(created.orderNumber, "123")
    ).toBeNull();
  });
});
