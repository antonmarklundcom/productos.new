import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { orderItems, orders, payments } from "../../src/db/schema";
import { startPagoparCheckout, PagoparCheckoutError } from "../../src/domain/pagopar/checkout";
import type { PagoparConfig } from "../../src/domain/pagopar/config";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createOrder, createVariant } from "../helpers/factories";

/**
 * `startPagoparCheckout` (PLAN.md 5.1).
 *
 * Lo que importa acá no es la llamada HTTP —eso está cubierto en
 * tests/unit/pagopar-client.test.ts— sino que la fila de `payments` quede
 * escrita con `provider_ref = hash_pedido` **antes** de mandar al comprador a
 * pagar. Sin esa fila, el aviso que llega antes del redirect no tiene a qué
 * pedido aplicarse (ARCH.md §4).
 */

const CONFIG: PagoparConfig = {
  publicKey: "publica-de-prueba",
  privateKey: "privada-de-prueba",
  baseUrl: "https://pagopar.example",
};

const HASH = "b92a3c6e319f08e49500328cbd342db19cf1cf07eab118414716a5f66d20cee3";
const TOTAL_PYG = 150_000;

describe.skipIf(!hasTestDb)("startPagoparCheckout", () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  function stubFetch(hashPedido = HASH) {
    const bodies: Array<Record<string, unknown>> = [];
    const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({ respuesta: true, resultado: [{ data: hashPedido }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return { impl, bodies };
  }

  async function seedOrder(status: "pendiente_pago" | "pagado" = "pendiente_pago") {
    const db = getTestDb();
    const orderId = await createOrder({
      status,
      paymentMethod: "tarjeta",
      totalPyg: TOTAL_PYG,
    });
    const variantId = await createVariant({ onHand: 10, pricePyg: 75_000 });
    await db.insert(orderItems).values({
      orderId,
      variantId,
      nameSnapshot: "Yerba — Único",
      skuSnapshot: "SKU-YERBA",
      unitPricePyg: 75_000,
      qty: 2,
      ivaRate: 10,
      lineTotalPyg: TOTAL_PYG,
    });
    return orderId;
  }

  it("deja la fila de payments con provider_ref = hash_pedido", async () => {
    const orderId = await seedOrder();
    const { impl } = stubFetch();

    const started = await startPagoparCheckout(orderId, { config: CONFIG, fetchImpl: impl });

    expect(started.hashPedido).toBe(HASH);

    const row = (
      await getTestDb()
        .select()
        .from(payments)
        .where(and(eq(payments.provider, "pagopar"), eq(payments.providerRef, HASH)))
        .limit(1)
    )[0];

    expect(row?.orderId).toBe(orderId);
    expect(row?.amountPyg).toBe(TOTAL_PYG);
    expect(row?.status).toBe("pending");
  });

  it("manda a Pagopar el número de pedido y el total exactos de la base", async () => {
    const orderId = await seedOrder();
    const { impl, bodies } = stubFetch();
    const orderNumber = (
      await getTestDb()
        .select({ orderNumber: orders.orderNumber })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1)
    )[0]?.orderNumber;

    await startPagoparCheckout(orderId, { config: CONFIG, fetchImpl: impl });

    expect(bodies[0]?.id_pedido_comercio).toBe(orderNumber);
    expect(bodies[0]?.monto_total).toBe("150000");
  });

  it("no crea la transacción dos veces si el comprador reintenta", async () => {
    const orderId = await seedOrder();
    const { impl } = stubFetch();

    await startPagoparCheckout(orderId, { config: CONFIG, fetchImpl: impl });
    await startPagoparCheckout(orderId, { config: CONFIG, fetchImpl: impl });

    // `UNIQUE (provider, provider_ref)`: la segunda refresca, no duplica.
    const rows = await getTestDb().select().from(payments);
    expect(rows).toHaveLength(1);
  });

  it("un pedido que ya no está pendiente no vuelve a la pasarela", async () => {
    const orderId = await seedOrder("pagado");
    const { impl } = stubFetch();

    await expect(
      startPagoparCheckout(orderId, { config: CONFIG, fetchImpl: impl })
    ).rejects.toThrow(PagoparCheckoutError);
  });

  it("un pedido inexistente falla claro", async () => {
    const { impl } = stubFetch();
    await expect(
      startPagoparCheckout(999_999, { config: CONFIG, fetchImpl: impl })
    ).rejects.toThrow(PagoparCheckoutError);
  });
});
