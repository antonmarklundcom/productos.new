import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TIENDA } from "@/config/tienda";
import {
  customerNoticeBody,
  resolveCustomerNotifier,
  type CustomerNoticeOrder,
} from "@/domain/order-customer-notifications";

/**
 * Los tres avisos a la compradora (fase O3): confirmado, pagado, enviado.
 *
 * Mismo criterio que `order-notifications.test.ts` para el aviso al comercio:
 * el texto se testea sin red, y el interruptor (`resolveCustomerNotifier`) se
 * testea por separado de a una variable por vez.
 */

const order: CustomerNoticeOrder = {
  orderId: 12,
  orderNumber: "PY-000042",
  customerName: "Rosa Giménez",
  accessToken: "a".repeat(64),
  totalPyg: 1_250_000,
  shippingMethodName: "Moto Asunción",
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda.com.py");
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("customerNoticeBody · recordatorio (O15)", () => {
  // 18:40 del 20 de abril, hora de Asunción (UTC-3, sin horario de verano).
  const reservedUntil = new Date("2026-04-20T21:40:00.000Z");

  it("lleva número, total, la hora límite en Asunción y el link al pedido", () => {
    const body = customerNoticeBody("recordatorio", { ...order, reservedUntil });

    expect(body).toContain("PY-000042");
    expect(body).toContain("₲ 1.250.000");
    expect(body).toContain("Rosa");
    expect(body).toContain("20/04/2026 18:40");
    expect(body).toContain(`https://tienda.com.py/pedido/PY-000042?t=${order.accessToken}`);
  });

  it("sin reserva no inventa una hora límite", () => {
    const body = customerNoticeBody("recordatorio", { ...order, reservedUntil: null });

    expect(body).toContain("PY-000042");
    expect(body).not.toContain("hasta las");
  });

  it("no lleva el teléfono de nadie ni datos bancarios", () => {
    const body = customerNoticeBody("recordatorio", { ...order, reservedUntil });

    expect(body).not.toMatch(/\+595/);
    expect(body).not.toMatch(/cuenta|RUC/i);
  });
});

describe("customerNoticeBody · confirmado", () => {
  it("lleva número, total, el nombre de la tienda y el link al pedido", () => {
    const body = customerNoticeBody("confirmado", order);

    expect(body).toContain("PY-000042");
    expect(body).toContain("₲ 1.250.000");
    expect(body).toContain(TIENDA.nombre);
    expect(body).toContain("Rosa");
    expect(body).toContain(`https://tienda.com.py/pedido/PY-000042?t=${order.accessToken}`);
  });

  it("con método de envío, lo menciona", () => {
    expect(customerNoticeBody("confirmado", order)).toContain("Moto Asunción");
  });

  it("sin método de envío (pedido viejo), no inventa la línea", () => {
    const body = customerNoticeBody("confirmado", { ...order, shippingMethodName: null });
    expect(body).not.toContain("Entrega:");
  });

  it("no lleva el teléfono de nadie", () => {
    expect(customerNoticeBody("confirmado", order)).not.toMatch(/\+595/);
  });
});

describe("customerNoticeBody · pagado", () => {
  it("lleva número, total y el link, sin el detalle de lo comprado", () => {
    const body = customerNoticeBody("pagado", order);

    expect(body).toContain("PY-000042");
    expect(body).toContain("₲ 1.250.000");
    expect(body).toContain(`https://tienda.com.py/pedido/PY-000042?t=${order.accessToken}`);
  });
});

describe("customerNoticeBody · enviado", () => {
  it("lleva el método de envío cuando existe", () => {
    expect(customerNoticeBody("enviado", order)).toContain("Moto Asunción");
  });

  it("sin método de envío, no inventa la línea", () => {
    const body = customerNoticeBody("enviado", { ...order, shippingMethodName: null });
    expect(body).not.toContain("Entrega:");
  });

  it("con nota del admin (número de seguimiento), la incluye", () => {
    const body = customerNoticeBody("enviado", order, { note: "Seguimiento: ABC123" });
    expect(body).toContain("Seguimiento: ABC123");
  });

  it("sin nota, no deja una línea vacía", () => {
    const body = customerNoticeBody("enviado", order, { note: "" });
    expect(body).not.toContain("Nota:");
  });

  // == O5 · seguimiento del envío ==
  //
  // El texto de este aviso es lo único que la compradora recibe cuando su
  // pedido sale. Sin tracking tiene que quedar **exactamente** como estaba
  // antes de O5: una tienda que reparte en moto propia no cargó nada nuevo y
  // no puede empezar a recibir líneas vacías ni un "Guía: " sin número.

  it("con courier y guía, los pone en una sola línea", () => {
    const body = customerNoticeBody("enviado", {
      ...order,
      trackingCarrier: "Aereopar",
      trackingCode: "AP-99887",
    });

    expect(body).toContain("Transporte: Aereopar · Guía AP-99887");
  });

  it("con link de seguimiento, lo agrega aparte", () => {
    const body = customerNoticeBody("enviado", {
      ...order,
      trackingCarrier: "Aereopar",
      trackingCode: "AP-99887",
      trackingUrl: "https://aereopar.com.py/seguimiento/AP-99887",
    });

    expect(body).toContain("https://aereopar.com.py/seguimiento/AP-99887");
  });

  it("sólo courier: no inventa una guía", () => {
    const body = customerNoticeBody("enviado", { ...order, trackingCarrier: "Moto propia" });

    expect(body).toContain("Transporte: Moto propia");
    expect(body).not.toContain("Guía");
  });

  it("sólo guía: no inventa un courier", () => {
    const body = customerNoticeBody("enviado", { ...order, trackingCode: "R-0007" });

    expect(body).toContain("Guía: R-0007");
    expect(body).not.toContain("Transporte:");
  });

  it("sin tracking, el texto es el de siempre", () => {
    const sinNada = customerNoticeBody("enviado", order);
    const conNulls = customerNoticeBody("enviado", {
      ...order,
      trackingCarrier: null,
      trackingCode: null,
      trackingUrl: null,
    });
    // Y con cadenas vacías, que es lo que llega de un formulario que el
    // mostrador dejó en blanco.
    const conVacios = customerNoticeBody("enviado", {
      ...order,
      trackingCarrier: "",
      trackingCode: "   ",
      trackingUrl: "",
    });

    expect(conNulls).toBe(sinNada);
    expect(conVacios).toBe(sinNada);
    expect(sinNada).not.toContain("Transporte");
    expect(sinNada).not.toContain("Guía");
  });
});

describe("customerNoticeBody · resena (pedido entregado)", () => {
  it("saluda por el nombre, pregunta por el pedido y lleva el link a su pedido", () => {
    const body = customerNoticeBody("resena", order);

    expect(body).toBe(
      `Hola Rosa! ¿Qué tal tu pedido PY-000042? Contanos qué te pareció: ` +
        `https://tienda.com.py/pedido/PY-000042?t=${order.accessToken}`,
    );
  });

  it("no lleva el apellido ni el total", () => {
    const body = customerNoticeBody("resena", order);

    expect(body).not.toContain("Giménez");
    expect(body).not.toContain("₲");
  });
});

describe("resolveCustomerNotifier — sin plantilla, apagado en cualquier canal", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WHATSAPP_CLOUD_PHONE_NUMBER_ID", "");
    vi.stubEnv("WHATSAPP_CLOUD_ACCESS_TOKEN", "");
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_NAME", "");
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_CONFIRMADO", "");
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_PAGADO", "");
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_ENVIADO", "");
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RESENA", "");
  });

  it("sin la plantilla de ese aviso, ni siquiera el sender de consola de dev manda algo", () => {
    // A diferencia del aviso al comercio, acá no hay sender de respaldo: cuál
    // de los tres avisos manda cada tienda es una decisión suya.
    expect(resolveCustomerNotifier("confirmado")).toBeNull();
  });

  it("cada plantilla enciende sólo su propio aviso", () => {
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_PAGADO", "cliente_pagado");

    expect(resolveCustomerNotifier("confirmado")).toBeNull();
    expect(resolveCustomerNotifier("enviado")).toBeNull();
    expect(resolveCustomerNotifier("pagado")?.sender.channel).toBe("consola");
  });

  it("el pedido de reseña tiene su propio interruptor", () => {
    expect(resolveCustomerNotifier("resena")).toBeNull();

    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RESENA", "cliente_resena");

    expect(resolveCustomerNotifier("resena")?.sender.channel).toBe("consola");
    expect(resolveCustomerNotifier("enviado")).toBeNull();
  });

  it("en producción, sin la plantilla, sigue apagado aunque exista Cloud", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WHATSAPP_CLOUD_PHONE_NUMBER_ID", "123");
    vi.stubEnv("WHATSAPP_CLOUD_ACCESS_TOKEN", "token");
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_NAME", "login_otp");

    expect(resolveCustomerNotifier("pagado")).toBeNull();
  });

  it("con Cloud completo y la plantilla de este aviso, manda por WhatsApp con esa plantilla", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WHATSAPP_CLOUD_PHONE_NUMBER_ID", "123");
    vi.stubEnv("WHATSAPP_CLOUD_ACCESS_TOKEN", "token");
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_NAME", "login_otp");
    vi.stubEnv("WHATSAPP_CLOUD_TEMPLATE_CLIENTE_ENVIADO", "cliente_enviado");

    const notifier = resolveCustomerNotifier("enviado");

    expect(notifier?.sender.channel).toBe("whatsapp");
    expect(notifier?.templateName).toBe("cliente_enviado");
  });
});
