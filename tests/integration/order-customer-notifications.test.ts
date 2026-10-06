import { desc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { orderEvents, orders } from "@/db/schema";
import type { MessageSender, OutgoingMessage } from "@/domain/messaging";
import {
  notifyCustomerOrderEvent,
  type CustomerNotifier,
} from "@/domain/order-customer-notifications";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createOrder, getStatus } from "../helpers/factories";

/**
 * `notifyCustomerOrderEvent` contra la base de verdad.
 *
 * Mismo criterio que `order-notifications.test.ts` (integration) para el
 * aviso al comercio: lo que importa es que un envío que falla **no toca el
 * pedido**, y acá además que el mismo aviso no se mande dos veces.
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

function notifier(sender: MessageSender): CustomerNotifier {
  return { sender, templateName: "cliente_pagado" };
}

async function eventos(orderId: number) {
  return getTestDb()
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(desc(orderEvents.id));
}

describe.skipIf(!hasTestDb)("notifyCustomerOrderEvent", () => {
  beforeEach(async () => {
    await resetTables();
    vi.restoreAllMocks();
  });
  afterAll(closeTestDb);

  it("manda el aviso al teléfono del pedido y deja aviso_cliente_pagado", async () => {
    const orderId = await createOrder({
      totalPyg: 350000,
      status: "pagado",
      customerPhone: "+595981555555",
    });
    const sender = fakeSender("ok");

    await notifyCustomerOrderEvent(orderId, "pagado", {
      notifier: notifier(sender),
    });

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe("+595981555555");
    expect(sender.sent[0]?.templateName).toBe("cliente_pagado");
    expect(sender.sent[0]?.body).toContain("₲ 350.000");

    const [evento] = await eventos(orderId);
    expect(evento?.reason).toBe("aviso_cliente_pagado");
    expect(evento?.actor).toBe("sistema");
    expect(evento?.actorUserId).toBeNull();
    expect(evento?.toStatus).toBe("pagado");
    expect(evento?.fromStatus).toBe("pagado");
  });

  it("un sender que tira no rompe nada: el pedido queda igual y el fallo queda anotado", async () => {
    const orderId = await createOrder();
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifyCustomerOrderEvent(orderId, "confirmado", {
        notifier: notifier(fakeSender("throw")),
      })
    ).resolves.toBeUndefined();

    expect(await getStatus(orderId)).toBe("pendiente_pago");

    const [evento] = await eventos(orderId);
    expect(evento?.reason).toMatch(/^aviso_cliente_confirmado_fallido: /);
    expect(evento?.reason).toContain("Error");

    const [pedido] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(pedido?.totalPyg).toBe(100000);
  });

  it("apagado (sin notifier) no manda nada ni escribe eventos", async () => {
    const orderId = await createOrder();

    await notifyCustomerOrderEvent(orderId, "confirmado", { notifier: null });

    expect(await eventos(orderId)).toHaveLength(0);
  });

  it("un pedido que no existe no explota ni inventa un evento", async () => {
    await expect(
      notifyCustomerOrderEvent(999_999, "pagado", {
        notifier: notifier(fakeSender("ok")),
      })
    ).resolves.toBeUndefined();
  });

  // El caso que existe la idempotencia: dos disparos del mismo aviso para el
  // mismo pedido —el hook de `transitionOrder` corriendo dos veces, o un
  // reintento— no lo mandan dos veces.
  it("idempotencia: un segundo disparo del mismo aviso no manda nada de nuevo", async () => {
    const orderId = await createOrder();
    const sender = fakeSender("ok");

    await notifyCustomerOrderEvent(orderId, "confirmado", {
      notifier: notifier(sender),
    });
    await notifyCustomerOrderEvent(orderId, "confirmado", {
      notifier: notifier(sender),
    });

    expect(sender.sent).toHaveLength(1);
    expect(await eventos(orderId)).toHaveLength(1);
  });

  // Un aviso de otro tipo para el mismo pedido no queda bloqueado por el
  // primero: cada `kind` tiene su propia marca de idempotencia.
  it("dos avisos de distinto tipo para el mismo pedido se mandan los dos", async () => {
    const orderId = await createOrder();
    const sender = fakeSender("ok");

    await notifyCustomerOrderEvent(orderId, "confirmado", {
      notifier: notifier(sender),
    });
    await notifyCustomerOrderEvent(orderId, "pagado", {
      notifier: notifier(sender),
    });

    expect(sender.sent).toHaveLength(2);
    const eventos_ = await eventos(orderId);
    expect(eventos_.map((e) => e.reason).sort()).toEqual([
      "aviso_cliente_confirmado",
      "aviso_cliente_pagado",
    ]);
  });

  it("la nota del admin (número de seguimiento) queda en el texto de 'enviado'", async () => {
    const orderId = await createOrder();
    const sender = fakeSender("ok");

    await notifyCustomerOrderEvent(orderId, "enviado", {
      notifier: notifier(sender),
      note: "Seguimiento: ABC123",
    });

    expect(sender.sent[0]?.body).toContain("Seguimiento: ABC123");
  });

  // El envío tiene timeout propio: un proveedor que se cuelga no puede dejar
  // colgada la promesa que `transitionOrder`/`createOrder` largaron sin await.
  it("un envío colgado termina como fallido y no espera para siempre", async () => {
    const orderId = await createOrder();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();

    const pendiente = notifyCustomerOrderEvent(orderId, "confirmado", {
      notifier: notifier(fakeSender("hang")),
    });
    await vi.advanceTimersByTimeAsync(13_000);
    vi.useRealTimers();
    await pendiente;

    const [evento] = await eventos(orderId);
    expect(evento?.reason).toMatch(/^aviso_cliente_confirmado_fallido: /);
    expect(evento?.reason).toContain("Error");
  });
});
