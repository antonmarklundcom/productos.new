import { seedPaymentReadiness } from "../helpers/db";
import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  orderEvents,
  orders,
  payments,
  receipts,
  type OrderStatus,
  type PaymentMethod,
} from "../../src/db/schema";
import { createOrder as placeOrder } from "../../src/domain/create-order";
import { transitionOrder } from "../../src/domain/orders";
import {
  findApprovedReceiptsWithoutMove,
  findImpossibleEdges,
  findOrdersPaidWithoutPayment,
  findPaymentAmountMismatches,
  findPaymentsWithoutTransition,
  reconcile,
} from "../../src/domain/reconciliation";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant } from "../helpers/factories";

/**
 * Invariantes entre tablas de `pnpm reconcile` (v2).
 *
 * Las dos direcciones, para cada control: con datos sanos no reporta nada, y
 * cada inconsistencia inyectada a mano aparece. Un control que nunca vio un
 * caso malo no es un control.
 *
 * Los casos malos se inyectan escribiendo las filas directamente, que es
 * exactamente lo que este control existe para detectar: nada del código de
 * producción puede producirlos.
 */

const TOTAL_PYG = 150_000;

describe.skipIf(!hasTestDb)("reconciliación: invariantes entre tablas", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  // ---------------------------------------------------------------------------
  // Andamiaje
  // ---------------------------------------------------------------------------

  async function insertOrder(options: {
    status?: OrderStatus;
    paymentMethod?: PaymentMethod;
    totalPyg?: number;
  }): Promise<{ id: number; orderNumber: string }> {
    const db = getTestDb();
    const orderNumber = `PY-T${randomBytes(4).toString("hex").toUpperCase()}`;
    const totalPyg = options.totalPyg ?? TOTAL_PYG;

    await db.insert(orders).values({
      orderNumber,
      accessToken: randomBytes(32).toString("hex"),
      status: options.status ?? "pendiente_pago",
      customerName: "Ana López",
      customerPhone: "+595981123456",
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: options.paymentMethod ?? "transferencia",
      subtotalPyg: totalPyg,
      totalPyg,
    });

    const id = (
      await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
    )[0]?.id;
    if (!id) throw new Error("no pude crear el pedido");
    return { id, orderNumber };
  }

  async function insertPayment(
    orderId: number,
    options: {
      amountPyg?: number;
      status?: "pending" | "paid" | "failed" | "refunded";
    } = {}
  ): Promise<void> {
    await getTestDb()
      .insert(payments)
      .values({
        orderId,
        provider: "pagopar",
        providerRef: randomBytes(16).toString("hex"),
        amountPyg: options.amountPyg ?? TOTAL_PYG,
        status: options.status ?? "paid",
      });
  }

  async function insertEvent(
    orderId: number,
    from: OrderStatus | null,
    to: OrderStatus
  ): Promise<void> {
    await getTestDb()
      .insert(orderEvents)
      .values({
        orderId,
        fromStatus: from,
        toStatus: to,
        actor: "test",
        reason: null,
      });
  }

  async function insertReceipt(
    orderId: number,
    review: "pending" | "approved"
  ): Promise<void> {
    await getTestDb()
      .insert(receipts)
      .values({
        orderId,
        cloudinaryId: `comprobantes/${randomBytes(6).toString("hex")}`,
        mime: "image/jpeg",
        bytes: 12_345,
        review,
      });
  }

  /** Un pedido de tarjeta cobrado por el camino real, de punta a punta. */
  async function pedidoSanoConTarjeta(): Promise<number> {
    const variantId = await createVariant({ onHand: 10, pricePyg: 50_000 });
    const order = await placeOrder({
      items: [{ variantId, qty: 2 }],
      customerName: "Ana López",
      customerPhone: "0981123456",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "tarjeta",
    });

    await insertPayment(order.orderId, { amountPyg: order.totalPyg });
    await transitionOrder(
      order.orderId,
      "pagado",
      "pagopar",
      "pago confirmado"
    );
    return order.orderId;
  }

  /** Un pedido por transferencia con comprobante aprobado, también real. */
  async function pedidoSanoPorTransferencia(): Promise<number> {
    const variantId = await createVariant({ onHand: 10, pricePyg: 40_000 });
    const order = await placeOrder({
      items: [{ variantId, qty: 1 }],
      customerName: "Beto Recalde",
      customerPhone: "0981123457",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      shipCity: "Asunción",
      shipAddress: "Av. España 456",
      paymentMethod: "transferencia",
    });

    await transitionOrder(
      order.orderId,
      "esperando_verificacion",
      "buyer",
      "comprobante subido"
    );
    await insertReceipt(order.orderId, "approved");
    await transitionOrder(
      order.orderId,
      "pagado",
      "admin:test",
      "comprobante aprobado"
    );
    return order.orderId;
  }

  // ---------------------------------------------------------------------------
  // Dirección 1: datos sanos no reportan nada
  // ---------------------------------------------------------------------------

  it("una base con pedidos cobrados por los dos caminos no reporta nada", async () => {
    await pedidoSanoConTarjeta();
    await pedidoSanoPorTransferencia();

    const report = await reconcile();

    expect(report.crossChecks).toEqual([]);
    expect(report.totalMismatches).toEqual([]);
    expect(report.lineMismatches).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("un pedido por transferencia cobrado no cuenta como pedido sin pago", async () => {
    // El control ya no acota por método: pasa porque aprobar el comprobante
    // registra el pago `spi` en la misma transacción que cobra el pedido
    // (TASKS.md §27), no porque se lo esté salteando.
    await pedidoSanoPorTransferencia();

    expect(await findOrdersPaidWithoutPayment()).toEqual([]);
  });

  it("la fila de creación (from_status NULL) no es una arista imposible", async () => {
    await pedidoSanoConTarjeta();

    expect(await findImpossibleEdges()).toEqual([]);
  });

  it("los avisos actuales e históricos no son aristas imposibles", async () => {
    const orderId = await pedidoSanoConTarjeta();
    await getTestDb()
      .insert(orderEvents)
      .values([
        {
          orderId,
          fromStatus: null,
          toStatus: "pagado",
          actor: "sistema",
          reason: "aviso_cliente_pagado",
        },
        {
          orderId,
          fromStatus: "pagado",
          toStatus: "pagado",
          actor: "sistema",
          reason: "aviso_cliente_pagado",
        },
        {
          orderId,
          fromStatus: null,
          toStatus: "enviado",
          actor: "sistema",
          reason: "aviso_cliente_enviado",
        },
        {
          orderId,
          fromStatus: "enviado",
          toStatus: "enviado",
          actor: "sistema",
          reason: "aviso_cliente_enviado",
        },
      ]);

    expect(await findImpossibleEdges()).toEqual([]);
  });

  it("NULL hacia pagado sin prefijo aviso_ sigue siendo una arista imposible", async () => {
    const order = await insertOrder({ status: "pagado" });
    await getTestDb().insert(orderEvents).values({
      orderId: order.id,
      fromStatus: null,
      toStatus: "pagado",
      actor: "sistema",
      reason: "pago_confirmado",
    });

    const found = await findImpossibleEdges();
    expect(found).toHaveLength(1);
    expect(found[0]?.orderNumber).toBe(order.orderNumber);
  });

  // ---------------------------------------------------------------------------
  // Dirección 2: cada inconsistencia inyectada se detecta
  // ---------------------------------------------------------------------------

  it("detecta un pedido de tarjeta cobrado sin fila de pago acreditada", async () => {
    const order = await insertOrder({
      status: "pagado",
      paymentMethod: "tarjeta",
    });
    await insertEvent(order.id, "pendiente_pago", "pagado");

    const found = await findOrdersPaidWithoutPayment();

    expect(found).toHaveLength(1);
    expect(found[0]?.orderNumber).toBe(order.orderNumber);
    expect(found[0]?.kind).toBe("pedido_cobrado_sin_pago");
    expect((await reconcile()).ok).toBe(false);
  });

  it("un pago todavía `pending` no cuenta como pago acreditado", async () => {
    const order = await insertOrder({
      status: "pagado",
      paymentMethod: "tarjeta",
    });
    await insertEvent(order.id, "pendiente_pago", "pagado");
    await insertPayment(order.id, { status: "pending" });

    // Sigue reportado: `pending` no es plata que entró.
    expect(await findOrdersPaidWithoutPayment()).toHaveLength(1);
  });

  it("detecta un pago acreditado cuyo pedido nunca pasó por pagado", async () => {
    const order = await insertOrder({
      status: "vencido",
      paymentMethod: "tarjeta",
    });
    await insertPayment(order.id);

    const found = await findPaymentsWithoutTransition();

    expect(found).toHaveLength(1);
    expect(found[0]?.orderNumber).toBe(order.orderNumber);
    expect(found[0]?.detail).toContain("nunca pasó");
  });

  it("un pedido que ya avanzó más allá de pagado no se reporta", async () => {
    // Lo que se mira es el log de auditoría, no el estado actual: un pedido
    // `entregado` pasó por `pagado` en su momento y está perfecto.
    const order = await insertOrder({
      status: "entregado",
      paymentMethod: "tarjeta",
    });
    await insertPayment(order.id);
    await insertEvent(order.id, "pendiente_pago", "pagado");
    await insertEvent(order.id, "pagado", "preparando");

    expect(await findPaymentsWithoutTransition()).toEqual([]);
  });

  it("detecta un pago cuyo monto no es el total del pedido", async () => {
    const order = await insertOrder({
      status: "pagado",
      paymentMethod: "tarjeta",
    });
    await insertEvent(order.id, "pendiente_pago", "pagado");
    await insertPayment(order.id, { amountPyg: TOTAL_PYG - 1 });

    const found = await findPaymentAmountMismatches();

    expect(found).toHaveLength(1);
    expect(found[0]?.orderNumber).toBe(order.orderNumber);
    // La resta la hace MySQL con enteros: el guaraní que falta se ve entero.
    expect(found[0]?.detail).toContain("-1");
  });

  it("detecta un comprobante aprobado que no movió el pedido", async () => {
    const order = await insertOrder({ status: "esperando_verificacion" });
    await insertReceipt(order.id, "approved");

    const found = await findApprovedReceiptsWithoutMove();

    expect(found).toHaveLength(1);
    expect(found[0]?.orderNumber).toBe(order.orderNumber);
    expect(found[0]?.kind).toBe("comprobante_aprobado_sin_movimiento");
  });

  it("un comprobante pendiente no se reporta", async () => {
    const order = await insertOrder({ status: "esperando_verificacion" });
    await insertReceipt(order.id, "pending");

    expect(await findApprovedReceiptsWithoutMove()).toEqual([]);
  });

  it("detecta una arista que la máquina de estados no permite", async () => {
    const order = await insertOrder({ status: "entregado" });
    await insertEvent(order.id, "entregado", "pendiente_pago");

    const found = await findImpossibleEdges();

    expect(found).toHaveLength(1);
    expect(found[0]?.orderNumber).toBe(order.orderNumber);
    expect(found[0]?.detail).toContain("entregado");
  });

  it("detecta un pedido que nació ya cobrado (from_status NULL hacia pagado)", async () => {
    const order = await insertOrder({
      status: "pagado",
      paymentMethod: "tarjeta",
    });
    await insertPayment(order.id);
    await insertEvent(order.id, null, "pagado");

    const found = await findImpossibleEdges();

    expect(found).toHaveLength(1);
    expect(found[0]?.orderNumber).toBe(order.orderNumber);
  });

  it("detecta un evento que no se mueve a ningún lado", async () => {
    const order = await insertOrder({
      status: "pagado",
      paymentMethod: "tarjeta",
    });
    await insertPayment(order.id);
    await insertEvent(order.id, "pagado", "pagado");

    // `transitionOrder` trata el no-op como no-op y no escribe evento: una fila
    // así sólo puede haberla escrito otra cosa.
    expect(await findImpossibleEdges()).toHaveLength(1);
  });

  it("reporta varias inconsistencias distintas a la vez", async () => {
    const sinPago = await insertOrder({
      status: "pagado",
      paymentMethod: "tarjeta",
    });
    await insertEvent(sinPago.id, "pendiente_pago", "pagado");

    const conComprobante = await insertOrder({
      status: "esperando_verificacion",
    });
    await insertReceipt(conComprobante.id, "approved");

    const report = await reconcile();

    expect(report.ok).toBe(false);
    expect(new Set(report.crossChecks.map((finding) => finding.kind))).toEqual(
      new Set([
        "pedido_cobrado_sin_pago",
        "comprobante_aprobado_sin_movimiento",
      ])
    );
  });
});
