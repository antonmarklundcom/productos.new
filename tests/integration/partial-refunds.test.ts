import { seedPaymentReadiness } from "../helpers/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { orderEvents, payments, refunds } from "@/db/schema";
import { createOrder as placeOrder } from "@/domain/create-order";
import { transitionOrder } from "@/domain/orders";
import { PaymentRecoveryError, refundPayment } from "@/domain/payment-recovery";
import { reconcile } from "@/domain/reconciliation";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import {
  createAdminUser,
  createOrder,
  createVariant,
  getOnHand,
  getStatus,
} from "../helpers/factories";

/**
 * Reembolsos parciales con ledger (O7, plan-operacion §5.3 A).
 *
 * Es la parte de O7 que mueve plata, así que lo que se fija acá es la
 * contabilidad: que no se pueda devolver más de lo que entró, que el acumulado
 * y el ledger no se separen nunca, y que `status = 'refunded'` signifique
 * exactamente "se devolvió todo".
 */

const ACTOR = "admin:due@tienda.py";
const MOTIVO = "la compradora devolvió una remera";

async function pagoCobrado(options: {
  amountPyg: number;
  orderStatus?: "pagado" | "vencido";
}) {
  const db = getTestDb();
  const orderId = await createOrder({
    status: options.orderStatus ?? "pagado",
    totalPyg: options.amountPyg,
  });
  const providerRef = `ref-${Math.random().toString(36).slice(2)}`;
  await db.insert(payments).values({
    orderId,
    provider: "spi",
    providerRef,
    amountPyg: options.amountPyg,
    status: "paid",
  });
  const [fila] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.providerRef, providerRef));
  return { orderId, paymentId: fila!.id };
}

async function pago(paymentId: number) {
  const [fila] = await getTestDb()
    .select({
      status: payments.status,
      amountPyg: payments.amountPyg,
      refundedPyg: payments.refundedPyg,
    })
    .from(payments)
    .where(eq(payments.id, paymentId));
  return fila!;
}

async function pedidoCobrado(
  status: "pagado" | "preparando" | "enviado" | "entregado"
) {
  const variantId = await createVariant({ onHand: 3, pricePyg: 100_000 });
  const order = await placeOrder({
    items: [{ variantId, qty: 1 }],
    customerName: "Ana López",
    customerPhone: "0981123456",
    docType: "NINGUNO",
    isConsumidorFinal: true,
    shipCity: "Asunción",
    shipAddress: "Av. Mcal. López 1234",
    paymentMethod: "contra_entrega",
  });
  // El cobro manual escribe el pago real y consume la reserva.
  for (const to of ["pagado", "preparando", "enviado", "entregado"] as const) {
    await transitionOrder(order.orderId, to, ACTOR);
    if (to === status) break;
  }
  const [payment] = await getTestDb()
    .select()
    .from(payments)
    .where(eq(payments.orderId, order.orderId));
  return {
    orderId: order.orderId,
    paymentId: payment!.id,
    totalPyg: order.totalPyg,
    variantId,
  };
}

describe.skipIf(!hasTestDb)(
  "devolución total desde la ficha del pedido",
  () => {
    beforeEach(async () => {
      await resetTables();
      await seedPaymentReadiness();
    });
    afterAll(closeTestDb);

    it.each(["pagado", "preparando", "enviado", "entregado"] as const)(
      "reembolsa %s con ledger, evento y reconcile sin hallazgos, sin reponer stock",
      async (status) => {
        const { orderId, paymentId, totalPyg, variantId } =
          await pedidoCobrado(status);
        const userId = await createAdminUser({ email: "due@tienda.py" });
        const stockBefore = await getOnHand(variantId);

        await expect(
          refundPayment({
            paymentId,
            reason: MOTIVO,
            actor: ACTOR,
            actorUserId: userId,
            allowSettled: true,
          })
        ).resolves.toMatchObject({
          changed: true,
          fullyRefunded: true,
          orderStatus: "reembolsado",
        });

        const ledger = await getTestDb()
          .select()
          .from(refunds)
          .where(eq(refunds.paymentId, paymentId));
        expect(ledger).toHaveLength(1);
        expect(ledger[0]).toMatchObject({
          amountPyg: totalPyg,
          reason: MOTIVO,
          actorUserId: userId,
        });
        expect(await pago(paymentId)).toMatchObject({
          status: "refunded",
          refundedPyg: totalPyg,
        });
        expect(await getStatus(orderId)).toBe("reembolsado");
        const events = await getTestDb()
          .select()
          .from(orderEvents)
          .where(eq(orderEvents.orderId, orderId));
        const devoluciones = events.filter((event) =>
          event.reason?.startsWith("pago devuelto:")
        );
        expect(devoluciones).toHaveLength(1);
        expect(devoluciones[0]).toMatchObject({
          fromStatus: status,
          toStatus: "reembolsado",
          reason: `pago devuelto: ${MOTIVO}`,
          actorUserId: userId,
        });
        expect(await getOnHand(variantId)).toBe(stockBefore);
        expect(await reconcile()).toEqual({
          ok: true,
          totalMismatches: [],
          lineMismatches: [],
          crossChecks: [],
        });
      }
    );

    it.each([undefined, false])(
      "sin allowSettled (%s) conserva pedidoRevivio y no escribe",
      async (allowSettled) => {
        const { orderId, paymentId } = await pedidoCobrado("entregado");
        const eventsBefore = await getTestDb()
          .select()
          .from(orderEvents)
          .where(eq(orderEvents.orderId, orderId));
        await expect(
          refundPayment({
            paymentId,
            reason: MOTIVO,
            actor: ACTOR,
            allowSettled,
          })
        ).rejects.toMatchObject({ code: "adminError.pago.pedidoRevivio" });
        expect(await getStatus(orderId)).toBe("entregado");
        expect(await pago(paymentId)).toMatchObject({
          status: "paid",
          refundedPyg: 0,
        });
        expect(await getTestDb().select().from(refunds)).toEqual([]);
        expect(
          await getTestDb()
            .select()
            .from(orderEvents)
            .where(eq(orderEvents.orderId, orderId))
        ).toEqual(eventsBefore);
      }
    );

    it("dos totales concurrentes escriben una sola devolución y el segundo devuelve changed false", async () => {
      const { orderId, paymentId, totalPyg } = await pedidoCobrado("entregado");
      const results = await Promise.all([
        refundPayment({
          paymentId,
          amountPyg: totalPyg,
          reason: MOTIVO,
          actor: ACTOR,
          allowSettled: true,
        }),
        refundPayment({
          paymentId,
          amountPyg: totalPyg,
          reason: MOTIVO,
          actor: ACTOR,
          allowSettled: true,
        }),
      ]);
      expect(results.map((result) => result.changed).sort()).toEqual([
        false,
        true,
      ]);
      expect(
        await getTestDb()
          .select()
          .from(refunds)
          .where(eq(refunds.paymentId, paymentId))
      ).toHaveLength(1);
      expect(await pago(paymentId)).toMatchObject({
        status: "refunded",
        refundedPyg: totalPyg,
      });
      expect(await getStatus(orderId)).toBe("reembolsado");
      const events = await getTestDb()
        .select()
        .from(orderEvents)
        .where(eq(orderEvents.orderId, orderId));
      expect(
        events.filter((event) => event.toStatus === "reembolsado")
      ).toHaveLength(1);
      expect((await reconcile()).ok).toBe(true);
    });

    it("un parcial seguido del saldo total reembolsa el pedido entregado", async () => {
      const { orderId, paymentId, totalPyg } = await pedidoCobrado("entregado");
      await refundPayment({
        paymentId,
        amountPyg: 25_000,
        reason: MOTIVO,
        actor: ACTOR,
        allowSettled: true,
      });
      expect(await getStatus(orderId)).toBe("entregado");
      await refundPayment({
        paymentId,
        reason: MOTIVO,
        actor: ACTOR,
        allowSettled: true,
      });
      const ledger = await getTestDb()
        .select()
        .from(refunds)
        .where(eq(refunds.paymentId, paymentId));
      expect(ledger.map((row) => row.amountPyg).sort((a, b) => a - b)).toEqual([
        25_000,
        totalPyg - 25_000,
      ]);
      expect(await getStatus(orderId)).toBe("reembolsado");
      expect((await reconcile()).ok).toBe(true);
    });
  }
);

describe.skipIf(!hasTestDb)("reembolso parcial", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
  });
  afterAll(closeTestDb);

  it("deja su fila en el ledger y suma en el acumulado", async () => {
    const { paymentId } = await pagoCobrado({ amountPyg: 300_000 });
    const userId = await createAdminUser({ email: "due@tienda.py" });

    await refundPayment({
      paymentId,
      amountPyg: 100_000,
      reason: MOTIVO,
      actor: ACTOR,
      actorUserId: userId,
    });

    const filas = await getTestDb()
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, paymentId));
    expect(filas).toHaveLength(1);
    expect(filas[0]?.amountPyg).toBe(100_000);
    expect(filas[0]?.actor).toBe(ACTOR);
    expect(filas[0]?.actorUserId).toBe(userId);

    const p = await pago(paymentId);
    expect(p.refundedPyg).toBe(100_000);
    // Un pago devuelto a medias **sigue siendo un pago cobrado**: marcarlo
    // `refunded` antes lo sacaría de los controles que verifican que la plata
    // que entró esté registrada.
    expect(p.status).toBe("paid");
  });

  it("NO mueve el estado del pedido", async () => {
    // Su caso de uso es justamente ése: la compradora se queda con dos de las
    // tres remeras y se le devuelve una. Ese pedido sigue su curso.
    const { orderId, paymentId } = await pagoCobrado({ amountPyg: 300_000 });

    await refundPayment({
      paymentId,
      amountPyg: 100_000,
      reason: MOTIVO,
      actor: ACTOR,
    });

    expect(await getStatus(orderId)).toBe("pagado");
  });

  it("deja rastro en la historia del pedido, con from = to", async () => {
    // Sin este evento, la única huella de que salió plata de este pedido
    // estaría en `refunds`, que la ficha del pedido no lee.
    const { orderId, paymentId } = await pagoCobrado({ amountPyg: 300_000 });

    await refundPayment({
      paymentId,
      amountPyg: 100_000,
      reason: MOTIVO,
      actor: ACTOR,
    });

    const eventos = await getTestDb()
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId));
    const parcial = eventos.find((evento) =>
      evento.reason?.includes("devolución parcial")
    );

    expect(parcial).toBeDefined();
    expect(parcial?.fromStatus).toBe(parcial?.toStatus);
    expect(parcial?.reason).toContain("100000");
    expect(parcial?.reason).toContain(MOTIVO);
  });

  it("dos parciales hasta el total dejan el pago refunded y cancelan el pedido", async () => {
    const { orderId, paymentId } = await pagoCobrado({
      amountPyg: 300_000,
      orderStatus: "vencido",
    });

    await refundPayment({
      paymentId,
      amountPyg: 100_000,
      reason: MOTIVO,
      actor: ACTOR,
    });
    expect((await pago(paymentId)).status).toBe("paid");

    await refundPayment({
      paymentId,
      amountPyg: 200_000,
      reason: MOTIVO,
      actor: ACTOR,
    });

    const p = await pago(paymentId);
    expect(p.status).toBe("refunded");
    expect(p.refundedPyg).toBe(300_000);
    // Y el que completa el total hace **exactamente** lo que hacía el
    // reembolso total de siempre: cancela el pedido.
    expect(await getStatus(orderId)).toBe("cancelado");

    const filas = await getTestDb()
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, paymentId));
    expect(filas).toHaveLength(2);
  });

  it("sin monto devuelve lo que queda, no el total otra vez", async () => {
    // Con parciales previos, "el total" y "lo que queda" son cosas distintas.
    // Devolver `amount_pyg` a secas devolvería de más.
    const { paymentId } = await pagoCobrado({
      amountPyg: 300_000,
      orderStatus: "vencido",
    });

    await refundPayment({
      paymentId,
      amountPyg: 120_000,
      reason: MOTIVO,
      actor: ACTOR,
    });
    await refundPayment({
      paymentId,
      reason: "devuelvo el resto",
      actor: ACTOR,
    });

    const p = await pago(paymentId);
    expect(p.refundedPyg).toBe(300_000);
    expect(p.status).toBe("refunded");

    const filas = await getTestDb()
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, paymentId));
    expect(filas.map((f) => f.amountPyg)).toEqual([120_000, 180_000]);
  });

  it("rechaza un monto que supera lo que queda, y no escribe nada", async () => {
    const { paymentId } = await pagoCobrado({ amountPyg: 300_000 });

    await refundPayment({
      paymentId,
      amountPyg: 250_000,
      reason: MOTIVO,
      actor: ACTOR,
    });

    await expect(
      refundPayment({
        paymentId,
        amountPyg: 100_000,
        reason: MOTIVO,
        actor: ACTOR,
      })
    ).rejects.toBeInstanceOf(PaymentRecoveryError);

    const p = await pago(paymentId);
    expect(p.refundedPyg).toBe(250_000);
    expect(
      await getTestDb()
        .select()
        .from(refunds)
        .where(eq(refunds.paymentId, paymentId))
    ).toHaveLength(1);
  });

  it("rechaza un monto que no es un entero positivo", async () => {
    const { paymentId } = await pagoCobrado({ amountPyg: 300_000 });

    for (const amountPyg of [0, -1000, 1000.5]) {
      await expect(
        refundPayment({ paymentId, amountPyg, reason: MOTIVO, actor: ACTOR })
      ).rejects.toBeInstanceOf(PaymentRecoveryError);
    }

    expect(await getTestDb().select().from(refunds)).toHaveLength(0);
  });

  it("un pago ya devuelto entero no acepta más", async () => {
    const { paymentId } = await pagoCobrado({
      amountPyg: 100_000,
      orderStatus: "vencido",
    });

    await refundPayment({ paymentId, reason: MOTIVO, actor: ACTOR });
    const segunda = await refundPayment({
      paymentId,
      amountPyg: 50_000,
      reason: MOTIVO,
      actor: ACTOR,
    });

    expect(segunda.changed).toBe(false);
    expect(
      await getTestDb()
        .select()
        .from(refunds)
        .where(eq(refunds.paymentId, paymentId))
    ).toHaveLength(1);
  });

  it("el total sobre un pedido vivo sigue rechazándose; el parcial no", async () => {
    // La regla de siempre: marcar la devolución total de un pedido que alguien
    // está por preparar lo cancelaría. Un parcial sobre ese mismo pedido es
    // legítimo y no lo toca.
    const { paymentId } = await pagoCobrado({
      amountPyg: 300_000,
      orderStatus: "pagado",
    });

    await expect(
      refundPayment({ paymentId, reason: MOTIVO, actor: ACTOR })
    ).rejects.toBeInstanceOf(PaymentRecoveryError);

    await expect(
      refundPayment({
        paymentId,
        amountPyg: 50_000,
        reason: MOTIVO,
        actor: ACTOR,
      })
    ).resolves.toMatchObject({ changed: true, fullyRefunded: false });
  });

  it("exige motivo, igual que el total", async () => {
    const { paymentId } = await pagoCobrado({ amountPyg: 300_000 });

    await expect(
      refundPayment({ paymentId, amountPyg: 1000, reason: "x", actor: ACTOR })
    ).rejects.toBeInstanceOf(PaymentRecoveryError);
  });
});

describe.skipIf(!hasTestDb)("reconcile y el ledger", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
  });
  afterAll(closeTestDb);

  it("queda verde después de parciales", async () => {
    const { paymentId } = await pagoCobrado({ amountPyg: 300_000 });
    await refundPayment({
      paymentId,
      amountPyg: 100_000,
      reason: MOTIVO,
      actor: ACTOR,
    });
    await refundPayment({
      paymentId,
      amountPyg: 50_000,
      reason: MOTIVO,
      actor: ACTOR,
    });

    const reporte = await reconcile();
    expect(
      reporte.crossChecks.filter((f) => f.kind === "devoluciones_no_cuadran")
    ).toEqual([]);
  });

  it("el evento del parcial no se reporta como arista imposible", async () => {
    // Tiene `from = to` a propósito. Sin la excepción, cada devolución parcial
    // legítima saldría reportada — y un control que grita siempre es un
    // control que nadie mira.
    const { paymentId } = await pagoCobrado({ amountPyg: 300_000 });
    await refundPayment({
      paymentId,
      amountPyg: 100_000,
      reason: MOTIVO,
      actor: ACTOR,
    });

    const reporte = await reconcile();
    expect(
      reporte.crossChecks.filter((f) => f.kind === "arista_imposible")
    ).toEqual([]);
  });

  it("se pone rojo si el acumulado se separa del ledger", async () => {
    const { paymentId } = await pagoCobrado({ amountPyg: 300_000 });
    await refundPayment({
      paymentId,
      amountPyg: 100_000,
      reason: MOTIVO,
      actor: ACTOR,
    });

    // A mano, como pasaría con un UPDATE suelto en la consola de MySQL: el
    // acumulado dice una cosa y el ledger otra.
    await getTestDb()
      .update(payments)
      .set({ refundedPyg: 999_000 })
      .where(eq(payments.id, paymentId));

    const reporte = await reconcile();
    expect(
      reporte.crossChecks.some((f) => f.kind === "devoluciones_no_cuadran")
    ).toBe(true);
    expect(reporte.ok).toBe(false);
  });

  it("se pone rojo si se devolvió más de lo que entró", async () => {
    const { paymentId } = await pagoCobrado({ amountPyg: 100_000 });
    await getTestDb().execute(
      sql`INSERT INTO \`refunds\` (\`payment_id\`, \`amount_pyg\`, \`reason\`, \`actor\`)
          VALUES (${paymentId}, 150000, 'a mano', 'test')`
    );
    await getTestDb()
      .update(payments)
      .set({ refundedPyg: 150_000 })
      .where(eq(payments.id, paymentId));

    const reporte = await reconcile();
    expect(
      reporte.crossChecks.some((f) => f.kind === "devoluciones_no_cuadran")
    ).toBe(true);
  });

  it("se pone rojo si un pago con todo devuelto sigue figurando como cobrado", async () => {
    // La otra dirección de la equivalencia. Un pago así aparecería en los
    // controles de "plata que entró" con plata que en realidad ya salió.
    const { paymentId } = await pagoCobrado({ amountPyg: 100_000 });
    await getTestDb().execute(
      sql`INSERT INTO \`refunds\` (\`payment_id\`, \`amount_pyg\`, \`reason\`, \`actor\`)
          VALUES (${paymentId}, 100000, 'a mano', 'test')`
    );
    await getTestDb()
      .update(payments)
      .set({ refundedPyg: 100_000, status: "paid" })
      .where(eq(payments.id, paymentId));

    const reporte = await reconcile();
    expect(
      reporte.crossChecks.some((f) => f.kind === "devoluciones_no_cuadran")
    ).toBe(true);
  });
});
