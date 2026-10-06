import { seedPaymentReadiness } from "../helpers/db";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  notificationOutbox,
  operationKeys,
  orderItems,
  orderReturns,
  orders,
  payments,
  refunds,
  shippingZones,
  stockReservations,
} from "@/db/schema";
import { purgeOperationKeys } from "@/domain/operation-keys";
import { createOrder, type CreateOrderInput } from "@/domain/create-order";
import { refundPayment } from "@/domain/payment-recovery";
import { registerReturn } from "@/domain/returns";
import { transitionOrder } from "@/domain/orders";
import {
  enqueueOrderNotice,
  dispatchOrderNotices,
} from "@/domain/notification-outbox";
import { MessageSendError } from "@/domain/messaging/sender";
import { startPagoparCheckout } from "@/domain/pagopar/checkout";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import {
  createOrder as seedOrder,
  createVariant,
  getOnHand,
} from "../helpers/factories";

describe.skipIf(!hasTestDb)("durable operations and notifications", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await resetTables();
    await seedPaymentReadiness();
  });
  afterAll(closeTestDb);
  const notifier = (
    send = vi.fn().mockResolvedValue({ messageId: "test-message" })
  ) => ({ sender: { channel: "consola" as const, label: "Test", send } });
  it("concurrent checkout and committed retries return one order and reservation; different keys are new purchases", async () => {
    await getTestDb()
      .insert(shippingZones)
      .values({
        slug: "test",
        name: "Test",
        cities: ["Asunción"],
        pricePyg: 0,
      });
    const variantId = await createVariant({ onHand: 20 });
    const input: CreateOrderInput = {
      operationKey: randomUUID(),
      customerName: "Test Customer",
      customerPhone: "0981123456",
      shipCity: "Asunción",
      shipAddress: "Test 123",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      paymentMethod: "transferencia",
      items: [{ variantId, qty: 1 }],
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => createOrder(input))
    );
    for (const result of results) expect(result).toEqual(results[0]);
    expect(await createOrder(input)).toEqual(results[0]);
    expect(await getTestDb().select().from(orders)).toHaveLength(1);
    expect(await getTestDb().select().from(stockReservations)).toHaveLength(1);
    await expect(
      createOrder({ ...input, customerName: "Changed Buyer" })
    ).rejects.toMatchObject({ code: "error.operacion.reutilizada" });
    await createOrder({ ...input, operationKey: randomUUID() });
    expect(await getTestDb().select().from(orders)).toHaveLength(2);
    await getTestDb()
      .update(operationKeys)
      .set({ createdAt: new Date("2020-01-01") });
    await purgeOperationKeys();
    await expect(createOrder(input)).rejects.toMatchObject({
      code: "error.operacion.archivada",
    });
    expect(await getTestDb().select().from(orders)).toHaveLength(2);
  });
  it("one partial refund per key, with distinct identical refunds still allowed", async () => {
    const orderId = await seedOrder({ status: "entregado", totalPyg: 100_000 });
    const [insert] = await getTestDb()
      .insert(payments)
      .values({
        orderId,
        provider: "spi",
        providerRef: "test-refund",
        amountPyg: 100_000,
        status: "paid",
      });
    const input = {
      operationKey: randomUUID(),
      paymentId: Number(insert.insertId),
      amountPyg: 25_000,
      allowSettled: true,
      reason: "Partial refund",
      actor: "test",
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => refundPayment(input))
    );
    results.forEach((result) => expect(result.refundedPyg).toBe(25_000));
    expect(await getTestDb().select().from(refunds)).toHaveLength(1);
    await refundPayment({ ...input, operationKey: randomUUID() });
    const [payment] = await getTestDb().select().from(payments);
    expect(payment!.refundedPyg).toBe(50_000);
  });
  it("one return and stock adjustment per key", async () => {
    const orderId = await seedOrder({ status: "entregado" });
    const variantId = await createVariant({ onHand: 5 });
    const [line] = await getTestDb()
      .insert(orderItems)
      .values({
        orderId,
        variantId,
        nameSnapshot: "Test",
        skuSnapshot: "Test",
        qty: 3,
        unitPricePyg: 10_000,
        lineTotalPyg: 30_000,
        ivaRate: 10,
      });
    const input = {
      operationKey: randomUUID(),
      orderId,
      reason: "Size return",
      actor: "test",
      items: [{ orderItemId: Number(line.insertId), qty: 1, restock: true }],
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => registerReturn(input))
    );
    results.forEach((result) =>
      expect(result.returnId).toBe(results[0]!.returnId)
    );
    expect(await getTestDb().select().from(orderReturns)).toHaveLength(1);
    expect(await getOnHand(variantId)).toBe(6);
    await registerReturn({ ...input, operationKey: randomUUID() });
    expect(await getOnHand(variantId)).toBe(7);
  });
  it("rollback removes the notice and workers see tracking only after commit", async () => {
    const orderId = await seedOrder({ status: "preparando" });
    const sender = notifier();
    await expect(
      getTestDb().transaction(async (tx) => {
        await transitionOrder(orderId, "enviado", "test", null, {
          executor: tx,
          tracking: { carrier: "Test Carrier", code: "Tracking123" },
        });
        await enqueueOrderNotice(tx, orderId, "enviado", "enviado", null, true);
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");
    await dispatchOrderNotices({ notifier: sender });
    expect(sender.sender.send).not.toHaveBeenCalled();
    await getTestDb().transaction(async (tx) => {
      await transitionOrder(orderId, "enviado", "test", null, {
        executor: tx,
        tracking: { carrier: "Test Carrier", code: "Tracking123" },
      });
      await enqueueOrderNotice(tx, orderId, "enviado", "enviado", null, true);
    });
    await Promise.all(
      Array.from({ length: 10 }, () =>
        dispatchOrderNotices({ notifier: sender })
      )
    );
    expect(sender.sender.send).toHaveBeenCalledTimes(1);
    expect(sender.sender.send.mock.calls[0]![0].body).toContain("Tracking123");
  });
  it("retries definite rejection, but never automatically retries uncertain delivery or an expired sender lease", async () => {
    const orderId = await seedOrder();
    await enqueueOrderNotice(
      getTestDb(),
      orderId,
      "confirmado",
      "pendiente_pago",
      null,
      true
    );
    const sender = notifier(
      vi.fn().mockRejectedValue(new MessageSendError("Rejected", "rejected"))
    );
    expect((await dispatchOrderNotices({ notifier: sender })).failed).toBe(1);
    await getTestDb()
      .update(notificationOutbox)
      .set({ nextAttemptAt: new Date(0) });
    sender.sender.send.mockRejectedValue(new Error("Connection disappeared"));
    expect((await dispatchOrderNotices({ notifier: sender })).unknown).toBe(1);
    await dispatchOrderNotices({ notifier: sender });
    expect(sender.sender.send).toHaveBeenCalledTimes(2);
    await getTestDb()
      .update(notificationOutbox)
      .set({ state: "sending", claimedAt: new Date(0) });
    await dispatchOrderNotices({ notifier: sender });
    expect(sender.sender.send).toHaveBeenCalledTimes(2);
    expect(
      (await getTestDb().select().from(notificationOutbox))[0]!.state
    ).toBe("unknown");
  });
  it("reuses the existing provider link and does not retry an uncertain provider POST", async () => {
    const orderId = await seedOrder({ paymentMethod: "tarjeta" });
    const variantId = await createVariant({ onHand: 5 });
    await getTestDb()
      .insert(orderItems)
      .values({
        orderId,
        variantId,
        nameSnapshot: "Test",
        skuSnapshot: "Test",
        qty: 1,
        unitPricePyg: 100_000,
        lineTotalPyg: 100_000,
        ivaRate: 10,
      });
    const config = {
      publicKey: "test",
      privateKey: "test",
      baseUrl: "https://provider.invalid",
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            respuesta: true,
            resultado: [{ hash_pedido: "existing-provider-hash" }],
          })
        )
      );
    const first = await startPagoparCheckout(orderId, { config, fetchImpl });
    expect(await startPagoparCheckout(orderId, { config, fetchImpl })).toEqual(
      first
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await getTestDb().delete(payments).where(eq(payments.orderId, orderId));
    await getTestDb()
      .update(orders)
      .set({ cardCheckoutState: "idle" })
      .where(eq(orders.id, orderId));
    fetchImpl.mockRejectedValue(new Error("Response lost"));
    await expect(
      startPagoparCheckout(orderId, { config, fetchImpl })
    ).rejects.toThrow();
    await expect(
      startPagoparCheckout(orderId, { config, fetchImpl })
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
