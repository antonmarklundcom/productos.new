import { desc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { orderEvents, orders } from "@/db/schema";
import type { MessageSender, OutgoingMessage } from "@/domain/messaging";
import {
  notifyOwnerNewOrder,
  type OwnerNotifier,
} from "@/domain/order-notifications";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createOrder, getStatus } from "../helpers/factories";

/**
 * El aviso al comercio, contra la base de verdad.
 *
 * Lo que se cuida acá es la regla que hace que esta feature no pueda costar
 * plata: **un envío que falla no toca el pedido**. La compradora ya compró; que
 * Meta esté caído es problema del comercio, no suyo.
 */

function fakeSender(
  behaviour: "ok" | "throw" | "hang"
): MessageSender & { sent: OutgoingMessage[] } {
  const sent: OutgoingMessage[] = [];
  return {
    channel: "consola",
    label: "test",
    sent,
    async send(message: OutgoingMessage): Promise<void> {
      sent.push(message);
      if (behaviour === "throw") throw new Error("Meta devolvió 500");
      if (behaviour === "hang") await new Promise(() => {});
    },
  };
}

function notifier(sender: MessageSender): OwnerNotifier {
  return { sender, to: "+595981123456", templateName: "pedido_nuevo" };
}

async function eventos(orderId: number) {
  return getTestDb()
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(desc(orderEvents.id));
}

describe.skipIf(!hasTestDb)("notifyOwnerNewOrder", () => {
  beforeEach(async () => {
    await resetTables();
    vi.restoreAllMocks();
  });
  afterAll(closeTestDb);

  it("manda el aviso y deja el evento aviso_dueno_enviado", async () => {
    const orderId = await createOrder({ totalPyg: 350000 });
    const sender = fakeSender("ok");

    await notifyOwnerNewOrder(orderId, { notifier: notifier(sender) });

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe("+595981123456");
    expect(sender.sent[0]?.templateName).toBe("pedido_nuevo");
    expect(sender.sent[0]?.body).toContain("₲ 350.000");

    const [evento] = await eventos(orderId);
    expect(evento?.reason).toBe("aviso_dueno_enviado");
    expect(evento?.actor).toBe("sistema");
    expect(evento?.actorUserId).toBeNull();
    // No es una transición: el estado no se movió.
    expect(evento?.fromStatus).toBe("pendiente_pago"); // aviso: from = to (S1)
    expect(evento?.toStatus).toBe("pendiente_pago");
  });

  // El test que más importa de la fase.
  it("un sender que tira no rompe nada: el pedido queda igual y el fallo queda anotado", async () => {
    const orderId = await createOrder();
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifyOwnerNewOrder(orderId, { notifier: notifier(fakeSender("throw")) })
    ).resolves.toBeUndefined();

    expect(await getStatus(orderId)).toBe("pendiente_pago");

    const [evento] = await eventos(orderId);
    expect(evento?.reason).toMatch(/^aviso_dueno_fallido: /);
    expect(evento?.reason).toContain("Error");
    expect(evento?.actor).toBe("sistema");

    const [pedido] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(pedido?.totalPyg).toBe(100000);
  });

  it("apagado (sin notifier) no manda nada ni escribe eventos", async () => {
    const orderId = await createOrder();

    await notifyOwnerNewOrder(orderId, { notifier: null });

    expect(await eventos(orderId)).toHaveLength(0);
  });

  it("un pedido que no existe no explota ni inventa un evento", async () => {
    await expect(
      notifyOwnerNewOrder(999_999, { notifier: notifier(fakeSender("ok")) })
    ).resolves.toBeUndefined();
  });

  it("el evento guarda el estado en el que el pedido sigue estando", async () => {
    const orderId = await createOrder({
      status: "pagado",
      paymentMethod: "tarjeta",
    });

    await notifyOwnerNewOrder(orderId, {
      notifier: notifier(fakeSender("ok")),
    });

    const [evento] = await eventos(orderId);
    expect(evento?.toStatus).toBe("pagado");
  });

  // El envío tiene timeout propio: un proveedor que se cuelga no puede dejar
  // colgada la promesa que el checkout largó sin await.
  it("un envío colgado termina como fallido y no espera para siempre", async () => {
    const orderId = await createOrder();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();

    const pendiente = notifyOwnerNewOrder(orderId, {
      notifier: notifier(fakeSender("hang")),
    });
    await vi.advanceTimersByTimeAsync(13_000);
    vi.useRealTimers();
    await pendiente;

    const [evento] = await eventos(orderId);
    expect(evento?.reason).toMatch(/^aviso_dueno_fallido: /);
    expect(evento?.reason).toContain("Error");
  });
});
