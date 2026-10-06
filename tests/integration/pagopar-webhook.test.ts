import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  orderEvents,
  orderItems,
  orders,
  paymentEvents,
  payments,
  type OrderStatus,
} from "../../src/db/schema";
import { webhookGuardToken } from "../../src/domain/pagopar/hash";
import { reserveStock } from "../../src/domain/stock";
import { resetRateLimits } from "../../src/lib/rate-limit";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant, getOnHand, getStatus } from "../helpers/factories";

/**
 * Webhook de Pagopar (PLAN.md 5.3).
 *
 * Los siete escenarios de la lista: válido · firma alterada · replay ×3 ·
 * monto distinto · pedido inexistente · webhook antes del redirect · pedido ya
 * enviado.
 *
 * Todo va contra la ruta real (`POST /api/webhooks/pagopar`), no contra la
 * función de dominio: el guard de la firma, el rate limit y el código HTTP son
 * parte de lo que hay que probar.
 */

const PRIVATE_KEY = "clave-privada-de-pagopar-para-los-tests";
const TOTAL_PYG = 150_000;

describe.skipIf(!hasTestDb)("POST /api/webhooks/pagopar", () => {
  const originalKey = process.env.PAGOPAR_PRIVATE_KEY;

  beforeEach(async () => {
    await resetTables();
    resetRateLimits();
    process.env.PAGOPAR_PRIVATE_KEY = PRIVATE_KEY;
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.PAGOPAR_PRIVATE_KEY = originalKey;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  /** Se importa adentro de cada test para que lea el env ya seteado. */
  async function route() {
    return import("../../src/app/api/webhooks/pagopar/route");
  }

  // -------------------------------------------------------------------------
  // Escenario compartido: un pedido con tarjeta que ya pasó por
  // iniciar-transaccion, o sea con su fila en `payments`.
  // -------------------------------------------------------------------------

  type Seeded = {
    orderId: number;
    orderNumber: string;
    variantId: number;
    hashPedido: string;
  };

  async function seedPagoparOrder(
    options: { status?: OrderStatus; onHand?: number; qty?: number; totalPyg?: number } = {}
  ): Promise<Seeded> {
    const db = getTestDb();
    const totalPyg = options.totalPyg ?? TOTAL_PYG;
    const qty = options.qty ?? 2;
    const variantId = await createVariant({
      onHand: options.onHand ?? 10,
      pricePyg: totalPyg / qty,
    });

    const orderNumber = `PY-T${randomBytes(4).toString("hex").toUpperCase()}`;
    await db.insert(orders).values({
      orderNumber,
      accessToken: randomBytes(32).toString("hex"),
      status: options.status ?? "pendiente_pago",
      customerName: "Ana López",
      customerPhone: "+595981123456",
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "tarjeta",
      subtotalPyg: totalPyg,
      totalPyg,
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
      unitPricePyg: totalPyg / qty,
      qty,
      ivaRate: 10,
      lineTotalPyg: totalPyg,
    });

    // La reserva se deja `held` incluso en los pedidos que arrancan `enviado`:
    // no es el caso realista, pero convierte "no se consumió stock" en una
    // afirmación verificable en vez de una vacía.
    await reserveStock(orderId, [{ variantId, qty }], {
      expiresAt: new Date(Date.now() + 45 * 60_000),
    });

    // Esta fila la escribe `startPagoparCheckout` antes de redirigir: es lo
    // que después le permite al webhook saber de qué pedido habla el aviso.
    const hashPedido = randomBytes(32).toString("hex");
    await db.insert(payments).values({
      orderId,
      provider: "pagopar",
      providerRef: hashPedido,
      amountPyg: totalPyg,
      status: "pending",
    });

    return { orderId, orderNumber, variantId, hashPedido };
  }

  function aviso(
    seeded: Pick<Seeded, "hashPedido">,
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      hash_pedido: seeded.hashPedido,
      pagado: true,
      monto: String(TOTAL_PYG),
      forma_pago: "TARJETA",
      ...overrides,
    };
  }

  function request(
    pedido: Record<string, unknown>,
    options: { token?: string } = {}
  ): Request {
    const token =
      options.token ??
      webhookGuardToken(PRIVATE_KEY, String(pedido.hash_pedido ?? ""));
    return new Request(`http://localhost/api/webhooks/pagopar?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resultado: [pedido] }),
    });
  }

  // -------------------------------------------------------------------------
  // Consultas de apoyo
  // -------------------------------------------------------------------------

  async function countPaymentEvents(): Promise<number> {
    return (await getTestDb().select().from(paymentEvents)).length;
  }

  async function transitionsTo(orderId: number, status: OrderStatus): Promise<number> {
    const rows = await getTestDb()
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.toStatus, status)));
    return rows.length;
  }

  async function paymentStatus(hashPedido: string): Promise<string | undefined> {
    const rows = await getTestDb()
      .select({ status: payments.status })
      .from(payments)
      .where(and(eq(payments.provider, "pagopar"), eq(payments.providerRef, hashPedido)))
      .limit(1);
    return rows[0]?.status;
  }

  // -------------------------------------------------------------------------
  // 1. Aviso válido
  // -------------------------------------------------------------------------

  it("un aviso válido marca el pedido pagado y descuenta el stock", async () => {
    const seeded = await seedPagoparOrder({ onHand: 10, qty: 2 });
    const { POST } = await route();

    const response = await POST(request(aviso(seeded)));

    expect(response.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("pagado");
    expect(await getOnHand(seeded.variantId)).toBe(8);
    expect(await paymentStatus(seeded.hashPedido)).toBe("paid");
    expect(await transitionsTo(seeded.orderId, "pagado")).toBe(1);
  });

  it("el estado lo mueve transitionOrder: queda la fila de auditoría", async () => {
    const seeded = await seedPagoparOrder();
    const { POST } = await route();

    await POST(request(aviso(seeded)));

    const events = await getTestDb()
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, seeded.orderId));
    const pago = events.find((event) => event.toStatus === "pagado");

    expect(pago?.fromStatus).toBe("pendiente_pago");
    expect(pago?.actor).toBe("pagopar");
  });

  it("contesta el sobre que espera Pagopar, con el pedido recibido", async () => {
    const seeded = await seedPagoparOrder();
    const { POST } = await route();
    const pedido = aviso(seeded);

    const response = await POST(request(pedido));

    // El formato vive en `webhookResponseBody` y está fijado en
    // tests/unit/pagopar-protocol.test.ts. Acá sólo se verifica que la ruta
    // devuelva ESE cuerpo y no otra cosa.
    expect(await response.json()).toEqual({ respuesta: true, resultado: [pedido] });
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("guarda el aviso en payment_events", async () => {
    const seeded = await seedPagoparOrder();
    const { POST } = await route();

    await POST(request(aviso(seeded)));

    const rows = await getTestDb().select().from(paymentEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe("pagopar");
    expect(rows[0]?.eventKey).toContain(seeded.hashPedido);
  });

  // -------------------------------------------------------------------------
  // 2. Firma alterada
  // -------------------------------------------------------------------------

  it("una firma alterada devuelve 401 y no toca nada", async () => {
    const seeded = await seedPagoparOrder({ onHand: 10, qty: 2 });
    const { POST } = await route();

    const valido = webhookGuardToken(PRIVATE_KEY, seeded.hashPedido);
    const alterado = `${valido.slice(0, -1)}${valido.endsWith("a") ? "b" : "a"}`;
    expect(alterado).toHaveLength(valido.length);

    const response = await POST(request(aviso(seeded), { token: alterado }));

    expect(response.status).toBe(401);
    expect(await getStatus(seeded.orderId)).toBe("pendiente_pago");
    expect(await getOnHand(seeded.variantId)).toBe(10);
    // Ni siquiera queda registrado: un aviso sin firma no es un evento.
    expect(await countPaymentEvents()).toBe(0);
  });

  it("sin token tampoco pasa, y el 401 no dice cuál de las dos cosas falló", async () => {
    const seeded = await seedPagoparOrder();
    const { POST } = await route();

    const sinToken = await POST(
      new Request("http://localhost/api/webhooks/pagopar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resultado: [aviso(seeded)] }),
      })
    );
    const tokenMalo = await POST(request(aviso(seeded), { token: "no-es-un-sha1" }));

    expect(sinToken.status).toBe(401);
    expect(tokenMalo.status).toBe(401);
    expect(await sinToken.json()).toEqual(await tokenMalo.json());
  });

  it("una firma del pedido de otro no sirve", async () => {
    const mio = await seedPagoparOrder();
    const ajeno = await seedPagoparOrder();
    const { POST } = await route();

    // Token válido... pero de otro hash_pedido.
    const response = await POST(
      request(aviso(mio), { token: webhookGuardToken(PRIVATE_KEY, ajeno.hashPedido) })
    );

    expect(response.status).toBe(401);
    expect(await getStatus(mio.orderId)).toBe("pendiente_pago");
  });

  // -------------------------------------------------------------------------
  // 3. Replay ×3
  // -------------------------------------------------------------------------

  it("el mismo aviso repetido 3 veces cobra una sola vez", async () => {
    const seeded = await seedPagoparOrder({ onHand: 10, qty: 2 });
    const { POST } = await route();
    const pedido = aviso(seeded);

    const primera = await POST(request(pedido));
    const repetidas = [
      await POST(request(pedido)),
      await POST(request(pedido)),
      await POST(request(pedido)),
    ];

    expect(primera.status).toBe(200);
    // Un repetido no es un error: contestar 4xx haría que Pagopar reintente.
    for (const response of repetidas) expect(response.status).toBe(200);

    expect(await getStatus(seeded.orderId)).toBe("pagado");
    // Lo que de verdad importa: el stock se descontó una sola vez.
    expect(await getOnHand(seeded.variantId)).toBe(8);
    expect(await transitionsTo(seeded.orderId, "pagado")).toBe(1);
    expect(await countPaymentEvents()).toBe(1);
  });

  it("un aviso de 'pagado' después de uno de 'no pagado' sí se procesa", async () => {
    // La clave de idempotencia lleva el estado además del hash: si fuera sólo
    // el hash, este pedido no se cobraría nunca.
    const seeded = await seedPagoparOrder();
    const { POST } = await route();

    const noPagado = await POST(request(aviso(seeded, { pagado: false })));
    expect(noPagado.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("pendiente_pago");

    const pagado = await POST(request(aviso(seeded, { pagado: true })));
    expect(pagado.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("pagado");
    expect(await countPaymentEvents()).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 4. Monto distinto
  // -------------------------------------------------------------------------

  it("un monto distinto al total no cobra el pedido", async () => {
    const seeded = await seedPagoparOrder({ onHand: 10, qty: 2 });
    const { POST } = await route();

    const response = await POST(request(aviso(seeded, { monto: "1000" })));

    expect(response.status).toBe(409);
    expect(await getStatus(seeded.orderId)).toBe("pendiente_pago");
    expect(await getOnHand(seeded.variantId)).toBe(10);
    expect(await paymentStatus(seeded.hashPedido)).toBe("pending");
  });

  it("el evento del monto distinto no queda registrado, así el corregido pasa", async () => {
    const seeded = await seedPagoparOrder();
    const { POST } = await route();

    await POST(request(aviso(seeded, { monto: "1000" })));
    expect(await countPaymentEvents()).toBe(0);

    const corregido = await POST(request(aviso(seeded)));
    expect(corregido.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("pagado");
  });

  it("un monto con céntimos distintos de cero se rechaza en vez de redondearse", async () => {
    const seeded = await seedPagoparOrder();
    const { POST } = await route();

    const response = await POST(request(aviso(seeded, { monto: "150000.50" })));

    expect(response.status).toBe(400);
    expect(await getStatus(seeded.orderId)).toBe("pendiente_pago");
  });

  it('un monto en "150000.00" es el mismo total y cobra normalmente', async () => {
    const seeded = await seedPagoparOrder();
    const { POST } = await route();

    const response = await POST(request(aviso(seeded, { monto: "150000.00" })));

    expect(response.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("pagado");
  });

  // -------------------------------------------------------------------------
  // 5. Pedido inexistente
  // -------------------------------------------------------------------------

  it("un hash_pedido desconocido devuelve 404 y no registra el evento", async () => {
    const { POST } = await route();
    const desconocido = { hashPedido: randomBytes(32).toString("hex") };

    const response = await POST(request(aviso(desconocido)));

    expect(response.status).toBe(404);
    // Rollback a propósito: si esto fue una carrera con iniciar-transaccion,
    // el reintento de Pagopar tiene que poder procesarlo.
    expect(await countPaymentEvents()).toBe(0);
  });

  it("el reintento de un pedido que todavía no existía se procesa bien", async () => {
    const { POST } = await route();
    const hashPedido = randomBytes(32).toString("hex");

    const temprano = await POST(request(aviso({ hashPedido })));
    expect(temprano.status).toBe(404);

    // Ahora sí commitea iniciar-transaccion, con el mismo hash.
    const seeded = await seedPagoparOrder();
    const db = getTestDb();
    await db
      .update(payments)
      .set({ providerRef: hashPedido })
      .where(eq(payments.orderId, seeded.orderId));

    const reintento = await POST(request(aviso({ hashPedido })));
    expect(reintento.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("pagado");
  });

  // -------------------------------------------------------------------------
  // 6. Webhook antes del redirect
  // -------------------------------------------------------------------------

  it("el aviso que llega antes de que el comprador vuelva cobra igual", async () => {
    // El caso normal en la práctica (ARCH.md §4): Pagopar avisa por atrás
    // mientras el navegador todavía está en su checkout. No hay sesión, no hay
    // cookie, no hay nada del comprador — sólo el aviso.
    const seeded = await seedPagoparOrder({ onHand: 10, qty: 2 });
    const { POST } = await route();

    const response = await POST(request(aviso(seeded)));

    expect(response.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("pagado");
    expect(await getOnHand(seeded.variantId)).toBe(8);

    // Y cuando el comprador finalmente vuelve, su página ya lo ve pagado: el
    // polling de /pedido/[n] no necesita nada más.
    const visto = await getTestDb()
      .select({ status: orders.status, paidAt: orders.paidAt })
      .from(orders)
      .where(eq(orders.id, seeded.orderId))
      .limit(1);
    expect(visto[0]?.status).toBe("pagado");
    expect(visto[0]?.paidAt).toBeInstanceOf(Date);
  });

  // -------------------------------------------------------------------------
  // 7. Pedido ya enviado
  // -------------------------------------------------------------------------

  it("un aviso tardío no arrastra un pedido `enviado` de vuelta a `pagado`", async () => {
    const seeded = await seedPagoparOrder({ status: "enviado", onHand: 10, qty: 2 });
    const { POST } = await route();

    const response = await POST(request(aviso(seeded)));

    // 200 y no un error: reintentar no cambiaría nada y sólo generaría ruido.
    expect(response.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("enviado");
    expect(await transitionsTo(seeded.orderId, "pagado")).toBe(0);
    expect(await getOnHand(seeded.variantId)).toBe(10);
    // El aviso sí queda registrado: es la única traza de que esto pasó.
    expect(await countPaymentEvents()).toBe(1);
  });

  it("deja el caso a la vista en el log para que el dueño lo revise", async () => {
    const seeded = await seedPagoparOrder({ status: "cancelado" });
    const { POST } = await route();

    await POST(request(aviso(seeded)));

    // Plata que entró para un pedido cancelado: no se puede resolver solo.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(seeded.orderNumber)
    );
    expect(await getStatus(seeded.orderId)).toBe("cancelado");
  });

  // -------------------------------------------------------------------------
  // Configuración y cuerpos raros
  // -------------------------------------------------------------------------

  it("sin PAGOPAR_PRIVATE_KEY la ruta responde 503, no 200", async () => {
    const seeded = await seedPagoparOrder();
    process.env.PAGOPAR_PRIVATE_KEY = "";
    const { POST } = await route();

    const response = await POST(request(aviso(seeded)));

    expect(response.status).toBe(503);
    expect(await getStatus(seeded.orderId)).toBe("pendiente_pago");
  });

  it("un cuerpo que no se puede interpretar devuelve 400", async () => {
    const { POST } = await route();

    const response = await POST(
      new Request("http://localhost/api/webhooks/pagopar?token=loquesea", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ no soy json",
      })
    );

    expect(response.status).toBe(400);
    expect(await countPaymentEvents()).toBe(0);
  });

  it("no se loguea nunca la clave privada ni el token recibido", async () => {
    const seeded = await seedPagoparOrder();
    const { POST } = await route();
    const token = webhookGuardToken(PRIVATE_KEY, seeded.hashPedido);

    await POST(request(aviso(seeded)));
    await POST(request(aviso(seeded), { token: "token-invalido-de-prueba" }));

    const logueado = [console.info, console.warn, console.error]
      .flatMap((fn) => vi.mocked(fn).mock.calls)
      .map((args) => args.map(String).join(" "))
      .join("\n");

    expect(logueado).not.toContain(PRIVATE_KEY);
    expect(logueado).not.toContain(token);
    expect(logueado).not.toContain("token-invalido-de-prueba");
  });
});
