import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  orderEvents,
  orderItems,
  orders,
  paymentEvents,
  payments,
  stockReservations,
  type OrderStatus,
} from "../../src/db/schema";
import { StockUnavailableError, transitionOrder } from "../../src/domain/orders";
import { webhookGuardToken } from "../../src/domain/pagopar/hash";
import { findUnmatchedPayments } from "../../src/domain/payment-recovery";
import { reserveStock } from "../../src/domain/stock";
import { resetRateLimits } from "../../src/lib/rate-limit";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createOrder, createVariant, getOnHand, getStatus } from "../helpers/factories";

/**
 * Pago que llega después de que el pedido murió (ARCH.md §4.1).
 *
 * Los dos sentidos de la misma carrera:
 *
 *  - el cron venció el pedido y el aviso de Pagopar llegó un segundo después,
 *  - el pedido sigue vivo pero su reserva se venció y el cron todavía no pasó.
 *
 * En los dos casos la pregunta es la misma —¿la mercadería sigue estando?— y
 * la respuesta la da `transitionOrder`, no quien lo llama.
 */

const PRIVATE_KEY = "clave-privada-de-pagopar-para-los-tests";
const TOTAL_PYG = 150_000;
const QTY = 2;

describe.skipIf(!hasTestDb)("pago tardío", () => {
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

  // ---------------------------------------------------------------------------
  // Andamiaje
  // ---------------------------------------------------------------------------

  type Seeded = { orderId: number; orderNumber: string; variantId: number; hashPedido: string };

  /**
   * Un pedido de tarjeta con su fila en `payments` (la que deja
   * `startPagoparCheckout`) y, opcionalmente, su reserva.
   */
  async function seedOrder(options: {
    status?: OrderStatus;
    onHand?: number;
    /** `null` = sin reserva, como queda un pedido después de vencer. */
    reservationExpiresAt?: Date | null;
    variantId?: number;
  }): Promise<Seeded> {
    const db = getTestDb();
    const variantId =
      options.variantId ??
      (await createVariant({ onHand: options.onHand ?? 10, pricePyg: TOTAL_PYG / QTY }));

    const orderNumber = `PY-T${randomBytes(4).toString("hex").toUpperCase()}`;
    await db.insert(orders).values({
      orderNumber,
      accessToken: randomBytes(32).toString("hex"),
      status: options.status ?? "vencido",
      customerName: "Ana López",
      customerPhone: "+595981123456",
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "tarjeta",
      subtotalPyg: TOTAL_PYG,
      totalPyg: TOTAL_PYG,
      reservedUntil: new Date(Date.now() - 60_000),
    });

    const orderId = (
      await db.select({ id: orders.id }).from(orders).where(eq(orders.orderNumber, orderNumber))
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

    if (options.reservationExpiresAt !== null && options.reservationExpiresAt !== undefined) {
      // Directo a la tabla y no por `reserveStock`: hace falta poder crear una
      // reserva ya vencida, que es justamente lo que esa función no deja hacer.
      await db.insert(stockReservations).values({
        variantId,
        orderId,
        qty: QTY,
        expiresAt: options.reservationExpiresAt,
        state: "held",
      });
    }

    const hashPedido = randomBytes(32).toString("hex");
    await db.insert(payments).values({
      orderId,
      provider: "pagopar",
      providerRef: hashPedido,
      amountPyg: TOTAL_PYG,
      status: "pending",
    });

    return { orderId, orderNumber, variantId, hashPedido };
  }

  /** Otro comprador se lleva `qty` unidades de la variante, con reserva viva. */
  async function competidor(variantId: number, qty: number): Promise<number> {
    const rivalId = await createOrder({ paymentMethod: "tarjeta" });
    await reserveStock(rivalId, [{ variantId, qty }], {
      expiresAt: new Date(Date.now() + 45 * 60_000),
    });
    return rivalId;
  }

  async function postAviso(seeded: Seeded): Promise<Response> {
    const { POST } = await import("../../src/app/api/webhooks/pagopar/route");
    const token = webhookGuardToken(PRIVATE_KEY, seeded.hashPedido);
    return POST(
      new Request(`http://localhost/api/webhooks/pagopar?token=${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hash_pedido: seeded.hashPedido,
          pagado: true,
          monto: String(TOTAL_PYG),
          forma_pago: "TARJETA",
        }),
      })
    );
  }

  async function paymentStatus(orderId: number): Promise<string | undefined> {
    const db = getTestDb();
    const row = (
      await db.select({ status: payments.status }).from(payments).where(eq(payments.orderId, orderId))
    )[0];
    return row?.status;
  }

  // ---------------------------------------------------------------------------
  // El pedido venció y el aviso llegó después
  // ---------------------------------------------------------------------------

  it("revive el pedido vencido cuando la mercadería sigue estando", async () => {
    const db = getTestDb();
    const seeded = await seedOrder({ status: "vencido", onHand: 10, reservationExpiresAt: null });

    const response = await postAviso(seeded);

    expect(response.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("pagado");
    // Se descontó una sola vez, y por la cantidad del pedido.
    expect(await getOnHand(seeded.variantId)).toBe(10 - QTY);
    expect(await paymentStatus(seeded.orderId)).toBe("paid");

    const events = await db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, seeded.orderId));
    expect(events).toHaveLength(1);
    expect(events[0]?.fromStatus).toBe("vencido");
    expect(events[0]?.toStatus).toBe("pagado");
    // El motivo queda escrito: dentro de un mes nadie se va a acordar de por
    // qué este pedido saltó de vencido a pagado.
    expect(events[0]?.reason).toMatch(/tardío/);

    // Y la reserva que se tomó para revivirlo quedó consumida, no colgada.
    const held = await db
      .select()
      .from(stockReservations)
      .where(
        and(eq(stockReservations.orderId, seeded.orderId), eq(stockReservations.state, "held"))
      );
    expect(held).toHaveLength(0);
  });

  it("no revive si el stock se vendió mientras el pedido estaba vencido", async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 2, pricePyg: TOTAL_PYG / QTY });
    const seeded = await seedOrder({ status: "vencido", variantId, reservationExpiresAt: null });
    // Las 2 unidades que quedaban ya están reservadas por otro comprador.
    await competidor(variantId, 2);

    const response = await postAviso(seeded);

    // 200 igual: reintentar no cambiaría nada y Pagopar no tiene la culpa.
    expect(response.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("vencido");
    expect(await getOnHand(variantId)).toBe(2);

    // Lo único que no se puede perder: el registro de que la plata entró.
    expect(await paymentStatus(seeded.orderId)).toBe("paid");
    const eventos = await db.select().from(paymentEvents);
    expect(eventos).toHaveLength(1);

    // Y no quedó ninguna reserva a medio tomar.
    const held = await db
      .select()
      .from(stockReservations)
      .where(
        and(eq(stockReservations.orderId, seeded.orderId), eq(stockReservations.state, "held"))
      );
    expect(held).toHaveLength(0);
  });

  it("un pedido cancelado no revive solo, aunque haya stock de sobra", async () => {
    const seeded = await seedOrder({ status: "cancelado", onHand: 10, reservationExpiresAt: null });

    const response = await postAviso(seeded);

    expect(response.status).toBe(200);
    expect(await getStatus(seeded.orderId)).toBe("cancelado");
    expect(await getOnHand(seeded.variantId)).toBe(10);
    expect(await paymentStatus(seeded.orderId)).toBe("paid");
  });

  // ---------------------------------------------------------------------------
  // Visibilidad para el dueño
  // ---------------------------------------------------------------------------

  it("lista la plata colgada y deja afuera la que sí tiene pedido cobrado", async () => {
    const conStock = await seedOrder({ status: "vencido", onHand: 10, reservationExpiresAt: null });

    const sinStockVariant = await createVariant({ onHand: 2, pricePyg: TOTAL_PYG / QTY });
    const sinStock = await seedOrder({
      status: "vencido",
      variantId: sinStockVariant,
      reservationExpiresAt: null,
    });
    await competidor(sinStockVariant, 2);

    await postAviso(conStock);
    await postAviso(sinStock);

    const colgados = await findUnmatchedPayments();

    expect(colgados.map((row) => row.orderNumber)).toEqual([sinStock.orderNumber]);
    expect(colgados[0]?.amountPyg).toBe(TOTAL_PYG);
    expect(colgados[0]?.orderTotalPyg).toBe(TOTAL_PYG);
    expect(colgados[0]?.orderStatus).toBe("vencido");
  });

  it("no reporta nada cuando todos los pagos tienen su pedido cobrado", async () => {
    const seeded = await seedOrder({ status: "vencido", onHand: 10, reservationExpiresAt: null });
    await postAviso(seeded);

    expect(await findUnmatchedPayments()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // El caso inverso: el pedido vive pero su reserva venció
  // ---------------------------------------------------------------------------

  it("no descuenta sobre una reserva vencida si el ítem se vendió mientras tanto", async () => {
    const variantId = await createVariant({ onHand: 2, pricePyg: TOTAL_PYG / QTY });
    const seeded = await seedOrder({
      status: "pendiente_pago",
      variantId,
      reservationExpiresAt: new Date(Date.now() - 60_000),
    });
    // La reserva del pedido venció y la vidriera ofreció esas unidades: otro
    // comprador se las llevó antes de que pasara el cron.
    await competidor(variantId, 2);

    await expect(
      transitionOrder(seeded.orderId, "pagado", "test", "cobro con reserva vencida")
    ).rejects.toBeInstanceOf(StockUnavailableError);

    expect(await getStatus(seeded.orderId)).toBe("pendiente_pago");
    expect(await getOnHand(variantId)).toBe(2);
  });

  it("re-toma la reserva vencida y descuenta una sola vez si el stock sigue libre", async () => {
    const db = getTestDb();
    const seeded = await seedOrder({
      status: "pendiente_pago",
      onHand: 10,
      reservationExpiresAt: new Date(Date.now() - 60_000),
    });

    await transitionOrder(seeded.orderId, "pagado", "test", "cobro con reserva vencida");

    expect(await getStatus(seeded.orderId)).toBe("pagado");
    // La clave: 10 − 2, no 10 − 4. La fila vencida se suelta antes de tomar la
    // nueva, así que no se consumen las dos.
    expect(await getOnHand(seeded.variantId)).toBe(10 - QTY);

    const reservas = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, seeded.orderId));
    expect(reservas.filter((row) => row.state === "consumed")).toHaveLength(1);
    expect(reservas.filter((row) => row.state === "released")).toHaveLength(1);
    expect(reservas.filter((row) => row.state === "held")).toHaveLength(0);
  });

  it("la reserva viva del propio pedido no se cuenta como competencia", async () => {
    // Última unidad, reservada por este mismo pedido: tiene que poder cobrarse.
    const variantId = await createVariant({ onHand: QTY, pricePyg: TOTAL_PYG / QTY });
    const seeded = await seedOrder({
      status: "pendiente_pago",
      variantId,
      reservationExpiresAt: new Date(Date.now() + 45 * 60_000),
    });

    await transitionOrder(seeded.orderId, "pagado", "test", "cobro normal");

    expect(await getStatus(seeded.orderId)).toBe("pagado");
    expect(await getOnHand(variantId)).toBe(0);
  });
});
