import { seedPaymentReadiness } from "../helpers/db";
import { randomBytes } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  payments,
  receipts,
  stockReservations,
  users,
  type PaymentMethod,
} from "../../src/db/schema";
import { createOrder as placeOrder } from "../../src/domain/create-order";
import {
  backfillManualPayments,
  manualPaymentRef,
  recordManualPayment,
} from "../../src/domain/manual-payments";
import {
  StockUnavailableError,
  transitionOrder,
} from "../../src/domain/orders";
import { reviewReceipt } from "../../src/domain/receipt-review";
import { findOrdersPaidWithoutPayment } from "../../src/domain/reconciliation";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant } from "../helpers/factories";

/**
 * El pago manual queda registrado (TASKS.md §27).
 *
 * Hasta este PR, cobrar por transferencia o contra entrega movía el pedido a
 * `pagado` sin escribir una sola fila en `payments`. Estos tests fijan las dos
 * mitades del arreglo: que la fila se escriba **en la misma transacción** que
 * cobra el pedido, y que no se pueda escribir dos veces.
 */

describe.skipIf(!hasTestDb)("pago manual registrado al cobrar", () => {
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

  async function placeManualOrder(
    paymentMethod: PaymentMethod,
    options: { onHand?: number; pricePyg?: number; qty?: number } = {}
  ) {
    const variantId = await createVariant({
      onHand: options.onHand ?? 10,
      pricePyg: options.pricePyg ?? 50_000,
    });
    const order = await placeOrder({
      items: [{ variantId, qty: options.qty ?? 1 }],
      customerName: "Ana López",
      customerPhone: "0981123456",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod,
    });
    return { ...order, variantId };
  }

  async function paymentsOf(orderId: number) {
    return getTestDb()
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId));
  }

  async function createReviewer(): Promise<number> {
    const db = getTestDb();
    const email = `duena-${randomBytes(4).toString("hex")}@tienda.py`;
    await db
      .insert(users)
      .values({ email, passwordHash: "x", name: "Dueña", role: "owner" });
    const row = (
      await db.select().from(users).where(eq(users.email, email))
    )[0];
    if (!row) throw new Error("no pude crear el usuario");
    return row.id;
  }

  async function uploadReceipt(orderId: number): Promise<number> {
    const db = getTestDb();
    const cloudinaryId = `comprobantes/${randomBytes(6).toString("hex")}`;
    await db
      .insert(receipts)
      .values({
        orderId,
        cloudinaryId,
        mime: "image/jpeg",
        bytes: 12_345,
        review: "pending",
      });
    const row = (
      await db
        .select()
        .from(receipts)
        .where(eq(receipts.cloudinaryId, cloudinaryId))
    )[0];
    if (!row) throw new Error("no pude crear el comprobante");
    return row.id;
  }

  // ---------------------------------------------------------------------------
  // El camino de escritura
  // ---------------------------------------------------------------------------

  it("aprobar un comprobante deja el pago registrado como `spi`", async () => {
    const order = await placeManualOrder("transferencia", {
      pricePyg: 47_500,
      qty: 3,
    });
    await transitionOrder(
      order.orderId,
      "esperando_verificacion",
      "buyer",
      "comprobante subido"
    );
    const receiptId = await uploadReceipt(order.orderId);

    await reviewReceipt({
      receiptId,
      decision: "approved",
      reviewerId: await createReviewer(),
      actor: "admin:duena@tienda.py",
    });

    const rows = await paymentsOf(order.orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe("spi");
    expect(rows[0]?.status).toBe("paid");
    expect(rows[0]?.providerRef).toBe(manualPaymentRef(order.orderNumber));
    // El monto es el total del pedido, entero, sin pasar por ninguna cuenta.
    expect(rows[0]?.amountPyg).toBe(order.totalPyg);
  });

  it("confirmar un contra entrega deja el pago registrado como `cod`", async () => {
    const order = await placeManualOrder("contra_entrega");

    await transitionOrder(
      order.orderId,
      "pagado",
      "admin:duena@tienda.py",
      "entregado y cobrado"
    );

    const rows = await paymentsOf(order.orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe("cod");
    expect(rows[0]?.status).toBe("paid");
    expect(rows[0]?.amountPyg).toBe(order.totalPyg);
  });

  it("un pedido de tarjeta no genera una segunda fila: esa la escribe Pagopar", async () => {
    const order = await placeManualOrder("tarjeta");
    await getTestDb()
      .insert(payments)
      .values({
        orderId: order.orderId,
        provider: "pagopar",
        providerRef: randomBytes(16).toString("hex"),
        amountPyg: order.totalPyg,
        status: "paid",
      });

    await transitionOrder(
      order.orderId,
      "pagado",
      "pagopar",
      "pago confirmado"
    );

    const rows = await paymentsOf(order.orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe("pagopar");
  });

  it("el rechazo del comprobante no registra ningún pago", async () => {
    const order = await placeManualOrder("transferencia");
    await transitionOrder(
      order.orderId,
      "esperando_verificacion",
      "buyer",
      "comprobante subido"
    );
    const receiptId = await uploadReceipt(order.orderId);

    await reviewReceipt({
      receiptId,
      decision: "rejected",
      note: "la imagen está cortada, no se lee el monto",
      reviewerId: await createReviewer(),
      actor: "admin:duena@tienda.py",
    });

    expect(await paymentsOf(order.orderId)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Idempotencia
  // ---------------------------------------------------------------------------

  it("dos aprobaciones simultáneas del mismo comprobante dejan un solo pago", async () => {
    const order = await placeManualOrder("transferencia");
    await transitionOrder(
      order.orderId,
      "esperando_verificacion",
      "buyer",
      "comprobante subido"
    );
    const receiptId = await uploadReceipt(order.orderId);
    const reviewerId = await createReviewer();

    // El doble click de verdad: dos transacciones abiertas a la vez sobre la
    // misma fila. No se afirma cuál gana —eso lo decide el scheduler— sino que
    // el resultado agregado es un solo cobro.
    const results = await Promise.allSettled([
      reviewReceipt({
        receiptId,
        decision: "approved",
        reviewerId,
        actor: "admin:a@tienda.py",
      }),
      reviewReceipt({
        receiptId,
        decision: "approved",
        reviewerId,
        actor: "admin:b@tienda.py",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(await paymentsOf(order.orderId)).toHaveLength(1);
  });

  it("una fila ya devuelta no vuelve a `paid` porque el pedido pase de nuevo por acá", async () => {
    const order = await placeManualOrder("transferencia");
    const db = getTestDb();
    await db.insert(payments).values({
      orderId: order.orderId,
      provider: "spi",
      providerRef: manualPaymentRef(order.orderNumber),
      amountPyg: order.totalPyg,
      status: "refunded",
    });

    const written = await recordManualPayment(db, {
      id: order.orderId,
      orderNumber: order.orderNumber,
      paymentMethod: "transferencia",
      totalPyg: order.totalPyg,
    });

    expect(written).toBe(false);
    const rows = await paymentsOf(order.orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("refunded");
  });

  // ---------------------------------------------------------------------------
  // Atomicidad: o cobra y registra, o no hace ninguna de las dos
  // ---------------------------------------------------------------------------

  it("si el cobro falla por falta de stock, no queda ni el pago ni el comprobante aprobado", async () => {
    // Única unidad, reservada por este pedido…
    const order = await placeManualOrder("transferencia", { onHand: 1 });
    await transitionOrder(
      order.orderId,
      "esperando_verificacion",
      "buyer",
      "comprobante subido"
    );
    const receiptId = await uploadReceipt(order.orderId);

    // …pero la reserva se pasó de hora y el cron todavía no vino, así que la
    // vidriera siguió ofreciendo esa unidad y otro comprador se la llevó
    // (ARCH.md §4.1, el caso inverso).
    await getTestDb()
      .update(stockReservations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(stockReservations.orderId, order.orderId));
    await placeOrder({
      items: [{ variantId: order.variantId, qty: 1 }],
      customerName: "Beto Recalde",
      customerPhone: "0981123457",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      shipCity: "Asunción",
      shipAddress: "Av. España 456",
      paymentMethod: "transferencia",
    });

    await expect(
      reviewReceipt({
        receiptId,
        decision: "approved",
        reviewerId: await createReviewer(),
        actor: "admin:duena@tienda.py",
      })
    ).rejects.toBeInstanceOf(StockUnavailableError);

    expect(await paymentsOf(order.orderId)).toEqual([]);
    const receipt = (
      await getTestDb()
        .select()
        .from(receipts)
        .where(eq(receipts.id, receiptId))
    )[0];
    expect(receipt?.review).toBe("pending");
  });

  // ---------------------------------------------------------------------------
  // La invariante que esto habilita
  // ---------------------------------------------------------------------------

  it("un pedido por transferencia cobrado por el camino real no lo reporta la reconciliación", async () => {
    const order = await placeManualOrder("transferencia");
    await transitionOrder(
      order.orderId,
      "esperando_verificacion",
      "buyer",
      "comprobante subido"
    );
    await transitionOrder(
      order.orderId,
      "pagado",
      "admin:test",
      "comprobante aprobado"
    );

    expect(await findOrdersPaidWithoutPayment()).toEqual([]);
  });

  it("un contra entrega cobrado sin fila de pago sí lo reporta (ya no hay filtro por método)", async () => {
    const order = await placeManualOrder("contra_entrega");
    await transitionOrder(
      order.orderId,
      "pagado",
      "admin:test",
      "entregado y cobrado"
    );
    // Se borra la fila a mano: es el estado en el que quedaron los pedidos
    // cobrados antes de este PR.
    await getTestDb()
      .delete(payments)
      .where(eq(payments.orderId, order.orderId));

    const found = await findOrdersPaidWithoutPayment();

    expect(found).toHaveLength(1);
    expect(found[0]?.orderNumber).toBe(order.orderNumber);
    expect(found[0]?.detail).toContain("contra_entrega");
  });

  // ---------------------------------------------------------------------------
  // Backfill
  // ---------------------------------------------------------------------------

  describe("backfill de los pedidos ya cobrados", () => {
    /** Un pedido cobrado como quedaban antes del PR: sin fila de pago. */
    async function pedidoCobradoSinPago(
      paymentMethod: PaymentMethod,
      totalPyg?: number
    ) {
      const order = await placeManualOrder(paymentMethod, {
        pricePyg: totalPyg,
      });
      if (paymentMethod === "transferencia") {
        await transitionOrder(
          order.orderId,
          "esperando_verificacion",
          "buyer",
          null
        );
      }
      await transitionOrder(order.orderId, "pagado", "admin:test", "cobrado");
      await getTestDb()
        .delete(payments)
        .where(eq(payments.orderId, order.orderId));
      return order;
    }

    it("el ensayo lista lo que falta y no escribe nada", async () => {
      const order = await pedidoCobradoSinPago("transferencia");

      const result = await backfillManualPayments();

      expect(result.inserted).toBe(0);
      expect(result.pending).toHaveLength(1);
      expect(result.pending[0]?.orderNumber).toBe(order.orderNumber);
      expect(result.pending[0]?.provider).toBe("spi");
      expect(await paymentsOf(order.orderId)).toEqual([]);
    });

    it("`--apply` escribe una fila por pedido, con el proveedor de su método", async () => {
      const transferencia = await pedidoCobradoSinPago("transferencia");
      const contraEntrega = await pedidoCobradoSinPago("contra_entrega");

      const result = await backfillManualPayments({ apply: true });

      expect(result.inserted).toBe(2);
      expect((await paymentsOf(transferencia.orderId))[0]?.provider).toBe(
        "spi"
      );
      expect((await paymentsOf(contraEntrega.orderId))[0]?.provider).toBe(
        "cod"
      );
      expect(await findOrdersPaidWithoutPayment()).toEqual([]);
    });

    it("correrlo dos veces no duplica ni cambia nada", async () => {
      await pedidoCobradoSinPago("transferencia");
      await backfillManualPayments({ apply: true });

      const segunda = await backfillManualPayments({ apply: true });

      expect(segunda.pending).toEqual([]);
      expect(segunda.inserted).toBe(0);
      const total = await getTestDb()
        .select({ n: sql<number>`COUNT(*)` })
        .from(payments);
      expect(Number(total[0]?.n)).toBe(1);
    });

    it("no toca los pedidos de tarjeta ni los que todavía no cobraron", async () => {
      const tarjeta = await placeManualOrder("tarjeta");
      await getTestDb()
        .insert(payments)
        .values({
          orderId: tarjeta.orderId,
          provider: "pagopar",
          providerRef: randomBytes(16).toString("hex"),
          amountPyg: tarjeta.totalPyg,
          status: "pending",
        });
      const pendiente = await placeManualOrder("transferencia");

      const result = await backfillManualPayments({ apply: true });

      expect(result.pending).toEqual([]);
      expect(result.inserted).toBe(0);
      expect(await paymentsOf(pendiente.orderId)).toEqual([]);
      expect(await paymentsOf(tarjeta.orderId)).toHaveLength(1);
    });

    it("el monto llega exacto: el entero del pedido, sin decimales ni redondeo", async () => {
      // Un total grande y feo: si en algún lado hubiera un float o un
      // `toFixed`, acá se vería.
      const order = await pedidoCobradoSinPago("transferencia", 8_765_431);

      await backfillManualPayments({ apply: true });

      // Se lee como texto crudo desde MySQL: comparar contra un `number` de JS
      // sería confiar justo en la conversión que este test desconfía.
      const raw = await getTestDb().execute(
        sql`SELECT CAST(p.amount_pyg AS CHAR) AS amount, CAST(o.total_pyg AS CHAR) AS total
            FROM payments p JOIN orders o ON o.id = p.order_id
            WHERE p.order_id = ${order.orderId}`
      );
      const row = (Array.isArray(raw) ? raw[0] : raw) as unknown as Array<
        Record<string, unknown>
      >;
      expect(String(row[0]?.amount)).toBe(String(row[0]?.total));
      expect(String(row[0]?.amount)).not.toContain(".");
    });
  });
});
