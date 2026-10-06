import { desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { orderEvents } from "@/db/schema";
import { transitionOrder } from "@/domain/orders";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createOrder } from "../helpers/factories";

/**
 * El hook post-transición de `transitionOrder` (ARCH.md §5.2.1): al entrar a
 * `pagado` o `enviado`, con la plantilla de ese aviso configurada, le avisa a
 * la compradora — sin importar por cuál camino llegó (panel, comprobante
 * aprobado, webhook de Pagopar, recuperación de pago tardío: todos pasan por
 * acá, así que un solo test de esta transición cubre a los cuatro).
 *
 * El "sender" que se mockea es la llamada de red que hace `whatsapp-cloud.ts`
 * — es más realista que mockear el módulo entero, y de paso prueba que el
 * teléfono, la plantilla y el texto que le llegan a Meta son los correctos.
 */

function mockFetchOk() {
  return vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), { status: 200 }),
  );
}

function requestBody(fetchMock: ReturnType<typeof mockFetchOk>): {
  to: string;
  template: { name: string; components: [{ parameters: [{ text: string }] }] };
} {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error("fetch no se llamó");
  const [, init] = call;
  return JSON.parse(init?.body as string);
}

const CLOUD_ENV = {
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: "123456",
  WHATSAPP_CLOUD_ACCESS_TOKEN: "token-de-prueba",
  WHATSAPP_CLOUD_TEMPLATE_NAME: "login_otp",
};

async function eventos(orderId: number) {
  return getTestDb()
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(desc(orderEvents.id));
}

describe.skipIf(!hasTestDb)("transitionOrder → aviso a la compradora", () => {
  beforeEach(async () => {
    await resetTables();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const [key, value] of Object.entries(CLOUD_ENV)) vi.stubEnv(key, value);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(closeTestDb);

  it("al entrar a pagado, con la plantilla configurada, le manda el aviso a su teléfono", async () => {
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_PAGADO", "cliente_pagado");
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const orderId = await createOrder({
      status: "esperando_verificacion",
      customerPhone: "+595981555555",
      totalPyg: 250000,
    });
    await transitionOrder(orderId, "pagado", "admin:test", "comprobante aprobado");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 2000, interval: 20 });

    const body = requestBody(fetchMock);
    expect(body.to).toBe("595981555555");
    expect(body.template.name).toBe("cliente_pagado");
    expect(body.template.components[0].parameters[0].text).toContain("₲ 250.000");

    // El evento se escribe después de que `fetch` responde, en el mismo
    // disparo sin await: esperarlo igual que al fetch, no leerlo una vez.
    await vi.waitFor(
      async () => expect((await eventos(orderId)).some((r) => r.reason === "aviso_cliente_pagado")).toBe(true),
      { timeout: 2000, interval: 20 },
    );
  });

  it("sin la plantilla de ese aviso, no manda nada aunque el resto de WhatsApp Cloud esté listo", async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const orderId = await createOrder({ status: "esperando_verificacion" });
    await transitionOrder(orderId, "pagado", "admin:test", "comprobante aprobado");

    // Nada que esperar de verdad: sin la plantilla, `transitionOrder` ni
    // intenta resolver un sender.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await eventos(orderId)).some((r) => r.reason?.startsWith("aviso_cliente_"))).toBe(false);
  });

  it("al entrar a enviado, la nota del admin viaja como el número de seguimiento", async () => {
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_ENVIADO", "cliente_enviado");
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const orderId = await createOrder({ status: "preparando" });
    await transitionOrder(orderId, "enviado", "admin:test", "Seguimiento: XYZ987");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 2000, interval: 20 });

    const body = requestBody(fetchMock);
    expect(body.template.name).toBe("cliente_enviado");
    expect(body.template.components[0].parameters[0].text).toContain("Seguimiento: XYZ987");

    // El evento se escribe después de que `fetch` responde, en el mismo
    // disparo sin await: esperarlo igual que al fetch, no leerlo una vez.
    await vi.waitFor(
      async () => expect((await eventos(orderId)).some((r) => r.reason === "aviso_cliente_enviado")).toBe(true),
      { timeout: 2000, interval: 20 },
    );
  });

  it("al entrar a entregado, con su plantilla, le pide la reseña con el link a su pedido — una sola vez", async () => {
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RESENA", "cliente_resena");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda.com.py");
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const orderId = await createOrder({ status: "enviado", customerPhone: "+595981444444" });
    await transitionOrder(orderId, "entregado", "admin:test");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 2000, interval: 20 });

    const body = requestBody(fetchMock);
    expect(body.to).toBe("595981444444");
    expect(body.template.name).toBe("cliente_resena");
    const texto = body.template.components[0].parameters[0].text;
    expect(texto).toContain("¿Qué tal tu pedido");
    expect(texto).toMatch(/https:\/\/tienda\.com\.py\/pedido\/PY-T[0-9A-F]+\?t=/);

    await vi.waitFor(
      async () => expect((await eventos(orderId)).some((r) => r.reason === "aviso_cliente_resena")).toBe(true),
      { timeout: 2000, interval: 20 },
    );

    // Idempotente por `order_events`, igual que "enviado": un segundo disparo
    // del aviso (p. ej. un reintento) no le vuelve a escribir.
    const { notifyCustomerOrderEvent } = await import("@/domain/order-customer-notifications");
    await notifyCustomerOrderEvent(orderId, "resena");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sin la plantilla de reseña, entregar el pedido no manda nada", async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const orderId = await createOrder({ status: "enviado" });
    await transitionOrder(orderId, "entregado", "admin:test");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("una transición que no cambia nada (webhook repetido) no dispara un segundo aviso", async () => {
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_PAGADO", "cliente_pagado");
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const orderId = await createOrder({ status: "pagado" });
    const result = await transitionOrder(orderId, "pagado", "webhook:pagopar");

    expect(result.changed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("una transición a otro estado (p. ej. preparando) no dispara ningún aviso al cliente", async () => {
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_PAGADO", "cliente_pagado");
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_ENVIADO", "cliente_enviado");
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const orderId = await createOrder({ status: "pagado" });
    await transitionOrder(orderId, "preparando", "admin:test");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
