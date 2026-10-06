import { seedPaymentReadiness } from "../helpers/db";
import { randomBytes, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  orderEvents,
  orders,
  payments,
  refunds,
  users,
  variants,
} from "../../src/db/schema";
import { advanceOrder } from "@/app/actions/admin-orders";
import { markPaymentRefunded } from "@/app/actions/admin-payments";
import { t } from "@/i18n";
import { createOrder as placeOrder } from "../../src/domain/create-order";
import {
  StockUnavailableError,
  transitionOrder,
} from "../../src/domain/orders";
import {
  PaymentRecoveryError,
  findUnmatchedPayments,
  refundPayment,
  retryOrderRevival,
} from "../../src/domain/payment-recovery";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import {
  createAdminUser,
  createVariant,
  getOnHand,
  getStatus,
} from "../helpers/factories";

// Sólo sustituimos la cookie y la caché de Next; permisos, dominio y DB reales.
const session = vi.hoisted(() => ({
  userId: 0,
  email: "due@tienda.py",
  role: "owner",
  sessionVersion: 1,
}));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(async () => session),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Las dos acciones sobre "Pagos sin pedido vivo" (ARCH.md §4.1).
 *
 * El #14 le dio al dueño la lista; esto le da lo que la lista implica.
 * Lo que se fija acá es que las dos releen el estado con el candado tomado en
 * vez de confiar en el id del formulario, y que el segundo click no hace daño.
 */

describe.skipIf(!hasTestDb)("recuperación de pagos colgados", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  // ---------------------------------------------------------------------------
  // Andamiaje: un pago acreditado cuyo pedido venció sin mercadería
  // ---------------------------------------------------------------------------

  /**
   * Reproduce el caso real: pedido de tarjeta, vence, la última unidad se
   * vende, y recién ahí llega el aviso de pago. El pago queda `paid` y el
   * pedido `vencido`.
   */
  async function pagoColgado(options: { onHand?: number } = {}) {
    const variantId = await createVariant({
      onHand: options.onHand ?? 1,
      pricePyg: 90_000,
    });
    const order = await placeOrder({
      items: [{ variantId, qty: 1 }],
      customerName: "Ana López",
      customerPhone: "0981123456",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "tarjeta",
    });

    const db = getTestDb();
    const providerRef = randomBytes(16).toString("hex");
    await db.insert(payments).values({
      orderId: order.orderId,
      provider: "pagopar",
      providerRef,
      amountPyg: order.totalPyg,
      status: "paid",
    });

    // El cron lo venció y soltó la reserva.
    await transitionOrder(
      order.orderId,
      "vencido",
      "cron",
      "sin pago a tiempo"
    );

    const paymentId = (
      await db
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.orderId, order.orderId))
    )[0]?.id;
    if (!paymentId) throw new Error("no pude crear el pago");

    return { ...order, variantId, paymentId };
  }

  /** Se lleva `qty` unidades de la variante, como haría otro comprador. */
  async function otroCompradorSeLleva(
    variantId: number,
    qty: number
  ): Promise<void> {
    await getTestDb()
      .update(variants)
      .set({ onHand: qty })
      .where(eq(variants.id, variantId));
  }

  async function eventsOf(orderId: number) {
    return getTestDb()
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId));
  }

  it.each(["pagado", "preparando", "enviado", "entregado"] as const)(
    "advanceOrder rechaza reembolsado desde %s sin tocar pedido, pago, ledger ni eventos",
    async (status) => {
      const { orderId, paymentId } = await pagoColgado({ onHand: 2 });
      await retryOrderRevival({ paymentId, actor: "admin:test" });
      if (status !== "pagado") {
        for (const to of ["preparando", "enviado", "entregado"] as const) {
          await transitionOrder(orderId, to, "admin:test");
          if (to === status) break;
        }
      }
      session.userId = await createAdminUser();
      session.role = "owner";
      const orderBefore = await getTestDb()
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      const paymentBefore = await getTestDb()
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId));
      const eventsBefore = await eventsOf(orderId);

      expect(
        await advanceOrder({
          orderId,
          to: "reembolsado",
          reason: "devolución total",
        })
      ).toEqual({
        ok: false,
        error: t("adminError.pedido.reembolsoPorFormulario"),
      });
      expect(
        await getTestDb().select().from(orders).where(eq(orders.id, orderId))
      ).toEqual(orderBefore);
      expect(
        await getTestDb()
          .select()
          .from(payments)
          .where(eq(payments.id, paymentId))
      ).toEqual(paymentBefore);
      expect(await eventsOf(orderId)).toEqual(eventsBefore);
      expect(await getTestDb().select().from(refunds)).toEqual([]);
    }
  );

  it("markPaymentRefunded valida allowSettled, conserva owner-only y pasa la opción al dominio", async () => {
    const { orderId, paymentId } = await pagoColgado({ onHand: 2 });
    await retryOrderRevival({ paymentId, actor: "admin:test" });
    session.userId = await createAdminUser();
    await getTestDb()
      .update(users)
      .set({ role: "staff" })
      .where(eq(users.id, session.userId));
    session.role = "staff";
    const input = {
      paymentId,
      reason: "devolución total",
      allowSettled: true,
      operationKey: randomUUID(),
    };
    expect(await markPaymentRefunded(input)).toMatchObject({
      ok: false,
      error: "Sólo el dueño puede hacer esto",
    });
    expect(await getTestDb().select().from(refunds)).toEqual([]);
    await getTestDb()
      .update(users)
      .set({ role: "owner" })
      .where(eq(users.id, session.userId));
    session.role = "owner";
    expect(
      await markPaymentRefunded({ ...input, allowSettled: "true" })
    ).toEqual({ ok: false, error: t("adminError.noEntendi.devolucion") });
    expect(
      await markPaymentRefunded({
        paymentId,
        reason: input.reason,
        operationKey: randomUUID(),
      })
    ).toEqual({
      ok: false,
      error: t("adminError.pago.pedidoRevivio", { estado: "pagado" }),
    });
    expect(await markPaymentRefunded(input)).toMatchObject({
      ok: true,
      changed: true,
      fullyRefunded: true,
    });
    expect(await getStatus(orderId)).toBe("reembolsado");
    expect(
      await getTestDb()
        .select()
        .from(refunds)
        .where(eq(refunds.paymentId, paymentId))
    ).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Reintentar la revitalización
  // ---------------------------------------------------------------------------

  it("revive el pedido cuando volvió a haber stock, y descuenta una sola vez", async () => {
    const colgado = await pagoColgado({ onHand: 1 });
    expect(await findUnmatchedPayments()).toHaveLength(1);

    const result = await retryOrderRevival({
      paymentId: colgado.paymentId,
      actor: "admin:duena@tienda.py",
    });

    expect(result.changed).toBe(true);
    expect(await getStatus(colgado.orderId)).toBe("pagado");
    expect(await getOnHand(colgado.variantId)).toBe(0);
    // Sale de la lista sola: se deriva de los datos, no de un flag.
    expect(await findUnmatchedPayments()).toEqual([]);
  });

  it("si la mercadería sigue sin estar, el pedido no se mueve y se puede reintentar de nuevo", async () => {
    const colgado = await pagoColgado({ onHand: 1 });
    await otroCompradorSeLleva(colgado.variantId, 0);

    await expect(
      retryOrderRevival({
        paymentId: colgado.paymentId,
        actor: "admin:duena@tienda.py",
      })
    ).rejects.toBeInstanceOf(StockUnavailableError);

    expect(await getStatus(colgado.orderId)).toBe("vencido");
    expect(await getOnHand(colgado.variantId)).toBe(0);
    // El pago sigue registrado y en la lista: eso nunca se toca.
    expect(await findUnmatchedPayments()).toHaveLength(1);

    // Y cuando el comercio repone, el mismo botón funciona.
    await otroCompradorSeLleva(colgado.variantId, 3);
    const result = await retryOrderRevival({
      paymentId: colgado.paymentId,
      actor: "admin:duena@tienda.py",
    });
    expect(result.changed).toBe(true);
    expect(await getStatus(colgado.orderId)).toBe("pagado");
    expect(await getOnHand(colgado.variantId)).toBe(2);
  });

  it("un pedido ya revivido no se vuelve a mover: el segundo click no es un error", async () => {
    const colgado = await pagoColgado({ onHand: 5 });
    await retryOrderRevival({
      paymentId: colgado.paymentId,
      actor: "admin:a@tienda.py",
    });

    const segunda = await retryOrderRevival({
      paymentId: colgado.paymentId,
      actor: "admin:b@tienda.py",
    });

    expect(segunda.changed).toBe(false);
    expect(await getOnHand(colgado.variantId)).toBe(4);
    expect(
      (await eventsOf(colgado.orderId)).filter((e) => e.toStatus === "pagado")
    ).toHaveLength(1);
  });

  it("un pedido cancelado no revive, con un mensaje escrito para el dueño", async () => {
    const colgado = await pagoColgado({ onHand: 5 });
    await transitionOrder(
      colgado.orderId,
      "cancelado",
      "admin:test",
      "el cliente se arrepintió"
    );

    await expect(
      retryOrderRevival({
        paymentId: colgado.paymentId,
        actor: "admin:duena@tienda.py",
      })
    ).rejects.toBeInstanceOf(PaymentRecoveryError);

    expect(await getStatus(colgado.orderId)).toBe("cancelado");
  });

  it("no se revive un pedido cuyo pago ya se devolvió", async () => {
    const colgado = await pagoColgado({ onHand: 5 });
    await refundPayment({
      paymentId: colgado.paymentId,
      reason: "devuelto por SPI el 12/8",
      actor: "admin:duena@tienda.py",
    });

    await expect(
      retryOrderRevival({
        paymentId: colgado.paymentId,
        actor: "admin:duena@tienda.py",
      })
    ).rejects.toBeInstanceOf(PaymentRecoveryError);
  });

  // ---------------------------------------------------------------------------
  // Marcar como devuelto
  // ---------------------------------------------------------------------------

  it("marca el pago devuelto, cancela el pedido y deja el motivo en el historial", async () => {
    const colgado = await pagoColgado({ onHand: 1 });
    await otroCompradorSeLleva(colgado.variantId, 0);

    const result = await refundPayment({
      paymentId: colgado.paymentId,
      reason: "transferí de vuelta por SPI el 12/8",
      actor: "admin:duena@tienda.py",
    });

    expect(result.changed).toBe(true);
    expect(await getStatus(colgado.orderId)).toBe("cancelado");

    const payment = (
      await getTestDb()
        .select()
        .from(payments)
        .where(eq(payments.id, colgado.paymentId))
    )[0];
    expect(payment?.status).toBe("refunded");

    const cancelacion = (await eventsOf(colgado.orderId)).find(
      (e) => e.toStatus === "cancelado"
    );
    expect(cancelacion?.reason).toContain("transferí de vuelta por SPI");
    expect(cancelacion?.actor).toBe("admin:duena@tienda.py");

    // Y sale de la lista: el pago dejó de estar `paid`.
    expect(await findUnmatchedPayments()).toEqual([]);
  });

  it("exige un motivo: sin él no escribe nada", async () => {
    const colgado = await pagoColgado();

    await expect(
      refundPayment({
        paymentId: colgado.paymentId,
        reason: "  ",
        actor: "admin:duena@tienda.py",
      })
    ).rejects.toBeInstanceOf(PaymentRecoveryError);

    expect(await getStatus(colgado.orderId)).toBe("vencido");
    expect(await findUnmatchedPayments()).toHaveLength(1);
  });

  it("marcar dos veces devuelto no vuelve a escribir nada", async () => {
    const colgado = await pagoColgado();
    await refundPayment({
      paymentId: colgado.paymentId,
      reason: "devuelto por SPI",
      actor: "admin:a@tienda.py",
    });

    const segunda = await refundPayment({
      paymentId: colgado.paymentId,
      reason: "devuelto por SPI",
      actor: "admin:b@tienda.py",
    });

    expect(segunda.changed).toBe(false);
    expect(
      (await eventsOf(colgado.orderId)).filter(
        (e) => e.toStatus === "cancelado"
      )
    ).toHaveLength(1);
  });

  it("no se marca devuelto un pedido que revivió desde que se abrió la pantalla", async () => {
    const colgado = await pagoColgado({ onHand: 5 });
    // Otro dueño lo revivió mientras esta pestaña mostraba la lista vieja.
    await retryOrderRevival({
      paymentId: colgado.paymentId,
      actor: "admin:a@tienda.py",
    });

    await expect(
      refundPayment({
        paymentId: colgado.paymentId,
        reason: "devuelto por SPI",
        actor: "admin:b@tienda.py",
      })
    ).rejects.toBeInstanceOf(PaymentRecoveryError);

    // El pedido cobrado queda intacto: no se cancela un pedido que alguien
    // está por preparar.
    expect(await getStatus(colgado.orderId)).toBe("pagado");
    const payment = (
      await getTestDb()
        .select()
        .from(payments)
        .where(eq(payments.id, colgado.paymentId))
    )[0];
    expect(payment?.status).toBe("paid");
  });

  it("el id del formulario no alcanza: un pago inexistente no rompe nada", async () => {
    await expect(
      retryOrderRevival({ paymentId: 999_999, actor: "admin:duena@tienda.py" })
    ).rejects.toBeInstanceOf(PaymentRecoveryError);
    await expect(
      refundPayment({
        paymentId: 999_999,
        reason: "devuelto",
        actor: "admin:duena@tienda.py",
      })
    ).rejects.toBeInstanceOf(PaymentRecoveryError);
  });

  // ---------------------------------------------------------------------------
  // Concurrencia: dos dueños, el mismo botón, al mismo tiempo
  // ---------------------------------------------------------------------------

  it("dos dueños tocando `reintentar` a la vez sobre la misma fila: un solo descuento", async () => {
    const colgado = await pagoColgado({ onHand: 1 });

    // Cada una en su propia conexión del pool, lanzadas juntas. En secuencia
    // este bug no aparece: hacen falta las dos transacciones abiertas a la vez.
    const results = await Promise.allSettled([
      retryOrderRevival({
        paymentId: colgado.paymentId,
        actor: "admin:a@tienda.py",
      }),
      retryOrderRevival({
        paymentId: colgado.paymentId,
        actor: "admin:b@tienda.py",
      }),
    ]);

    // No se afirma quién ganó —eso lo decide el scheduler— sino la forma del
    // resultado: nadie explota, y el trabajo se hizo una sola vez.
    for (const result of results) {
      expect(result.status).toBe("fulfilled");
    }
    const changed = results.filter(
      (result) => result.status === "fulfilled" && result.value.changed
    );
    expect(changed).toHaveLength(1);

    expect(await getStatus(colgado.orderId)).toBe("pagado");
    expect(await getOnHand(colgado.variantId)).toBe(0);
    expect(
      (await eventsOf(colgado.orderId)).filter((e) => e.toStatus === "pagado")
    ).toHaveLength(1);
    expect(await findUnmatchedPayments()).toEqual([]);
  });

  it("reintentar y devolver a la vez: gana uno solo, y el otro no deja nada a medias", async () => {
    const colgado = await pagoColgado({ onHand: 1 });

    const [revival, refund] = await Promise.allSettled([
      retryOrderRevival({
        paymentId: colgado.paymentId,
        actor: "admin:a@tienda.py",
      }),
      refundPayment({
        paymentId: colgado.paymentId,
        reason: "devuelto por SPI",
        actor: "admin:b@tienda.py",
      }),
    ]);

    const status = await getStatus(colgado.orderId);
    const payment = (
      await getTestDb()
        .select()
        .from(payments)
        .where(eq(payments.id, colgado.paymentId))
    )[0];

    // Las dos combinaciones legítimas, según quién tomó el candado primero.
    // Lo que no puede pasar es un pedido cobrado con la plata devuelta, ni un
    // pedido cancelado con el stock descontado.
    if (revival.status === "fulfilled" && revival.value.changed) {
      expect(refund.status).toBe("rejected");
      expect(status).toBe("pagado");
      expect(payment?.status).toBe("paid");
      expect(await getOnHand(colgado.variantId)).toBe(0);
    } else {
      expect(refund.status).toBe("fulfilled");
      expect(status).toBe("cancelado");
      expect(payment?.status).toBe("refunded");
      expect(await getOnHand(colgado.variantId)).toBe(1);
    }
  });
});
