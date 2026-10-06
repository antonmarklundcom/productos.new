import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { orderEvents, orderItems, orders, paymentEvents, payments } from "../../src/db/schema";
import { startPagoparCheckout } from "../../src/domain/pagopar/checkout";
import { mockHashPedido, simulateMockPayment } from "../../src/domain/pagopar/mock";
import { pagoparCheckoutUrl } from "../../src/domain/pagopar/config";
import { reserveStock } from "../../src/domain/stock";
import { resetRateLimits } from "../../src/lib/rate-limit";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant, getOnHand, getStatus } from "../helpers/factories";

/**
 * Ciclo completo con `PAGOPAR_MODE=mock`.
 *
 * Lo que se prueba acá no es el simulador: es que el simulador **no se saltea
 * nada**. El checkout mockeado escribe la misma fila de `payments` que el real,
 * y el aviso simulado entra por `POST /api/webhooks/pagopar` de verdad, así que
 * ejercita los mismos caminos que `pagopar-webhook.test.ts` verifica contra un
 * aviso "real": firma → idempotencia (`payment_events`) → verificación de monto
 * → `transitionOrder()`.
 *
 * Por eso cada caso mira las mismas cosas que la suite del webhook —estado del
 * pedido, filas de `order_events`, stock, `payment_events`— y no simplemente
 * "el mock contestó 200".
 *
 * El candado que impide que todo esto exista en producción se prueba aparte,
 * en `tests/unit/pagopar-mock-mode.test.ts`.
 */

const TOTAL_PYG = 150_000;
const QTY = 2;

describe.skipIf(!hasTestDb)("PAGOPAR_MODE=mock — ciclo completo", () => {
  const originalEnv = {
    mode: process.env.PAGOPAR_MODE,
    publicKey: process.env.PAGOPAR_PUBLIC_KEY,
    privateKey: process.env.PAGOPAR_PRIVATE_KEY,
    baseUrl: process.env.PAGOPAR_BASE_URL,
  };

  beforeEach(async () => {
    await resetTables();
    resetRateLimits();

    // Sin ninguna credencial: el punto del modo mock es que la demo corre en
    // una máquina que nunca vio una cuenta de Pagopar.
    process.env.PAGOPAR_MODE = "mock";
    delete process.env.PAGOPAR_PUBLIC_KEY;
    delete process.env.PAGOPAR_PRIVATE_KEY;
    delete process.env.PAGOPAR_BASE_URL;

    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    restore("PAGOPAR_MODE", originalEnv.mode);
    restore("PAGOPAR_PUBLIC_KEY", originalEnv.publicKey);
    restore("PAGOPAR_PRIVATE_KEY", originalEnv.privateKey);
    restore("PAGOPAR_BASE_URL", originalEnv.baseUrl);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  // -------------------------------------------------------------------------
  // Escenario: un pedido con tarjeta recién creado, todavía sin pasar por
  // `startPagoparCheckout` — o sea, sin fila en `payments`.
  // -------------------------------------------------------------------------

  type Seeded = { orderId: number; orderNumber: string; variantId: number };

  async function seedOrder(): Promise<Seeded> {
    const db = getTestDb();
    const variantId = await createVariant({
      onHand: 10,
      pricePyg: TOTAL_PYG / QTY,
    });

    const orderNumber = `PY-M${randomBytes(4).toString("hex").toUpperCase()}`;
    await db.insert(orders).values({
      orderNumber,
      accessToken: randomBytes(32).toString("hex"),
      status: "pendiente_pago",
      customerName: "Ana López",
      customerPhone: "+595981123456",
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "tarjeta",
      subtotalPyg: TOTAL_PYG,
      totalPyg: TOTAL_PYG,
      reservedUntil: new Date(Date.now() + 45 * 60_000),
    });

    const orderId = (
      await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1)
    )[0]?.id;
    if (!orderId) throw new Error("no pude crear el pedido");

    await db.insert(orderItems).values({
      orderId,
      variantId,
      nameSnapshot: "Yerba — Único",
      skuSnapshot: `SKU-${orderNumber}`,
      unitPricePyg: TOTAL_PYG / QTY,
      qty: QTY,
      ivaRate: 10,
      lineTotalPyg: TOTAL_PYG,
    });

    await reserveStock(orderId, [{ variantId, qty: QTY }], {
      expiresAt: new Date(Date.now() + 45 * 60_000),
    });

    return { orderId, orderNumber, variantId };
  }

  async function countPaymentEvents(): Promise<number> {
    return (await getTestDb().select().from(paymentEvents)).length;
  }

  async function transitionsToPagado(orderId: number): Promise<number> {
    const rows = await getTestDb()
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.toStatus, "pagado")));
    return rows.length;
  }

  async function paymentRow(hashPedido: string) {
    const rows = await getTestDb()
      .select()
      .from(payments)
      .where(and(eq(payments.provider, "pagopar"), eq(payments.providerRef, hashPedido)))
      .limit(1);
    return rows[0];
  }

  // -------------------------------------------------------------------------
  // 1. La ida: iniciar-transaccion sin red ni credenciales
  // -------------------------------------------------------------------------

  it("el checkout abre la transacción sin salir a la red y deja la fila de payments", async () => {
    // Si el simulador se saltea y alguien llama al fetch global, esto explota
    // con un mensaje claro en vez de intentar hablar con un host inexistente.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("el modo mock no debería llamar a fetch");
    });

    const seeded = await seedOrder();
    const started = await startPagoparCheckout(seeded.orderId);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(started.hashPedido).toBe(mockHashPedido(seeded.orderNumber));
    expect(started.totalPyg).toBe(TOTAL_PYG);

    // La fila que después le permite al webhook saber de qué pedido habla.
    const payment = await paymentRow(started.hashPedido);
    expect(payment?.orderId).toBe(seeded.orderId);
    expect(payment?.amountPyg).toBe(TOTAL_PYG);
    expect(payment?.status).toBe("pending");
    // El sobre guardado es el que devolvió el simulador, con su marca.
    expect(JSON.stringify(payment?.rawPayload)).toContain("pagopar_mock");
  });

  it("manda al comprador a la pasarela simulada, que es una ruta interna", async () => {
    const seeded = await seedOrder();
    const started = await startPagoparCheckout(seeded.orderId);

    const url = pagoparCheckoutUrl(started.hashPedido);
    expect(url).toBe(`/dev/pagopar/${started.hashPedido}`);
    // Nada de host externo: el formulario del checkout lo navega con el router.
    expect(url).not.toMatch(/^https?:\/\//);
  });

  it("reintentar el checkout no duplica la fila de payments", async () => {
    const seeded = await seedOrder();

    const primera = await startPagoparCheckout(seeded.orderId);
    const segunda = await startPagoparCheckout(seeded.orderId);

    expect(segunda.hashPedido).toBe(primera.hashPedido);
    const rows = await getTestDb().select().from(payments);
    expect(rows).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 2. La vuelta: el aviso simulado entra por la ruta real
  // -------------------------------------------------------------------------

  it("el pago simulado marca el pedido pagado por el camino de transitionOrder", async () => {
    const seeded = await seedOrder();
    const { hashPedido } = await startPagoparCheckout(seeded.orderId);

    const result = await simulateMockPayment({
      hashPedido,
      montoPyg: TOTAL_PYG,
    });

    expect(result.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("pagado");
    // El stock se consume al confirmar la reserva, igual que con un pago real.
    expect(await getOnHand(seeded.variantId)).toBe(8);
    expect((await paymentRow(hashPedido))?.status).toBe("paid");

    // La fila de auditoría: el estado se movió por `transitionOrder()` y no por
    // un UPDATE del simulador.
    const events = await getTestDb()
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, seeded.orderId));
    const pago = events.find((event) => event.toStatus === "pagado");
    expect(pago?.fromStatus).toBe("pendiente_pago");
    expect(pago?.actor).toBe("pagopar");
  });

  it("el aviso simulado queda registrado en payment_events", async () => {
    const seeded = await seedOrder();
    const { hashPedido } = await startPagoparCheckout(seeded.orderId);

    await simulateMockPayment({ hashPedido, montoPyg: TOTAL_PYG });

    const rows = await getTestDb().select().from(paymentEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe("pagopar");
    expect(rows[0]?.eventKey).toContain(hashPedido);
  });

  // -------------------------------------------------------------------------
  // 3. Los mismos casos feos que la suite del webhook real
  // -------------------------------------------------------------------------

  it("el mismo aviso repetido 3 veces cobra una sola vez", async () => {
    const seeded = await seedOrder();
    const { hashPedido } = await startPagoparCheckout(seeded.orderId);
    const aviso = { hashPedido, montoPyg: TOTAL_PYG };

    const primera = await simulateMockPayment(aviso);
    const repetidas = [
      await simulateMockPayment(aviso),
      await simulateMockPayment(aviso),
      await simulateMockPayment(aviso),
    ];

    expect(primera.status).toBe(200);
    // Un repetido no es un error: un 4xx haría que Pagopar reintentara.
    for (const response of repetidas) expect(response.status).toBe(200);

    expect(await getStatus(seeded.orderId)).toBe("pagado");
    expect(await getOnHand(seeded.variantId)).toBe(8);
    expect(await transitionsToPagado(seeded.orderId)).toBe(1);
    expect(await countPaymentEvents()).toBe(1);
  });

  it("un monto que no coincide con el total devuelve 409 y no cobra", async () => {
    const seeded = await seedOrder();
    const { hashPedido } = await startPagoparCheckout(seeded.orderId);

    const result = await simulateMockPayment({
      hashPedido,
      montoPyg: TOTAL_PYG - 1000,
    });

    expect(result.status).toBe(409);
    expect(await getStatus(seeded.orderId)).toBe("pendiente_pago");
    expect(await getOnHand(seeded.variantId)).toBe(10);
    expect((await paymentRow(hashPedido))?.status).toBe("pending");
    // El evento no queda registrado, así el aviso corregido puede pasar.
    expect(await countPaymentEvents()).toBe(0);

    const corregido = await simulateMockPayment({
      hashPedido,
      montoPyg: TOTAL_PYG,
    });
    expect(corregido.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("pagado");
  });

  it("un aviso simulado con firma inválida devuelve 401 y no toca nada", async () => {
    const seeded = await seedOrder();
    const { hashPedido } = await startPagoparCheckout(seeded.orderId);

    const result = await simulateMockPayment({
      hashPedido,
      montoPyg: TOTAL_PYG,
      firmaInvalida: true,
    });

    expect(result.status).toBe(401);
    expect(await getStatus(seeded.orderId)).toBe("pendiente_pago");
    expect(await getOnHand(seeded.variantId)).toBe(10);
    // Un aviso sin firma no llega a ser un evento.
    expect(await countPaymentEvents()).toBe(0);
  });

  it("un 'no pagado' deja el pedido esperando, y el 'pagado' posterior sí entra", async () => {
    const seeded = await seedOrder();
    const { hashPedido } = await startPagoparCheckout(seeded.orderId);

    const rechazado = await simulateMockPayment({
      hashPedido,
      montoPyg: TOTAL_PYG,
      pagado: false,
    });
    expect(rechazado.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("pendiente_pago");

    const pagado = await simulateMockPayment({
      hashPedido,
      montoPyg: TOTAL_PYG,
    });
    expect(pagado.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("pagado");
    // La clave de idempotencia lleva el estado: son dos eventos distintos.
    expect(await countPaymentEvents()).toBe(2);
  });

  it("un hash_pedido que no existe devuelve 404", async () => {
    const result = await simulateMockPayment({
      hashPedido: mockHashPedido("PY-NO-EXISTE"),
      montoPyg: TOTAL_PYG,
    });

    expect(result.status).toBe(404);
    expect(await countPaymentEvents()).toBe(0);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
