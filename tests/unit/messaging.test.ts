import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateLoginCode,
  hashLoginCode,
  loginCodeMessage,
} from "@/domain/login-tokens";
import {
  createConsoleSender,
  messagingConfigured,
  resolveMessageSender,
  whatsappCloudConfig,
} from "@/domain/messaging";

/**
 * El sender y el código (PLAN.md FASE 2, PR F.1 y F.2).
 *
 * Lo que más se prueba acá es el **apagado**: sin credenciales la opción no se
 * ofrece, y en producción el sender de consola no existe. Un botón de "mandame
 * un código" que no puede mandar nada deja a la persona esperando un mensaje
 * que no va a llegar.
 */

const ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

describe("configuración de WhatsApp Cloud", () => {
  it("sin variables, no hay configuración", () => {
    delete process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_CLOUD_ACCESS_TOKEN;
    delete process.env.WHATSAPP_CLOUD_TEMPLATE_NAME;

    expect(whatsappCloudConfig()).toBeNull();
  });

  it("configurado a medias es lo mismo que no configurado", () => {
    // Con la mitad de las credenciales la llamada falla igual, pero más tarde
    // y peor: cuando alguien ya está esperando el mensaje.
    process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_CLOUD_ACCESS_TOKEN = "token";
    delete process.env.WHATSAPP_CLOUD_TEMPLATE_NAME;

    expect(whatsappCloudConfig()).toBeNull();
  });

  it("con las tres variables, sale la configuración con su default de versión", () => {
    process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_CLOUD_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_CLOUD_TEMPLATE_NAME = "codigo_login";
    delete process.env.WHATSAPP_CLOUD_API_VERSION;

    expect(whatsappCloudConfig()).toMatchObject({
      phoneNumberId: "123",
      templateName: "codigo_login",
      apiVersion: "v21.0",
    });
  });
});

describe("qué sender se usa", () => {
  it("en dev, sin credenciales, la consola", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;

    expect(resolveMessageSender()?.channel).toBe("consola");
    expect(messagingConfigured()).toBe(true);
  });

  it("en producción, sin credenciales, NINGUNO", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_CLOUD_ACCESS_TOKEN;
    delete process.env.WHATSAPP_CLOUD_TEMPLATE_NAME;

    // El sender de consola imprime el código en el log del servidor. En un
    // hosting compartido eso no es un lugar privado, y del otro lado hay una
    // llave que abre la sesión de una compradora.
    expect(resolveMessageSender()).toBeNull();
    expect(messagingConfigured()).toBe(false);
  });

  it("en producción, con credenciales, WhatsApp", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_CLOUD_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_CLOUD_TEMPLATE_NAME = "codigo_login";

    expect(resolveMessageSender()?.channel).toBe("whatsapp");
  });
});

describe("el código", () => {
  it("son siempre 6 dígitos, con ceros a la izquierda si hacen falta", () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateLoginCode()).toMatch(/^\d{6}$/);
    }
  });

  it("no se repite de forma obvia", () => {
    const codes = new Set(
      Array.from({ length: 200 }, () => generateLoginCode())
    );
    // Con un millón de valores, 200 tiradas casi nunca repiten. Si esto falla,
    // el generador dejó de ser aleatorio.
    expect(codes.size).toBeGreaterThan(190);
  });

  it("cubre todo el espacio, incluidos los que empiezan con cero", () => {
    const codes = Array.from({ length: 3000 }, () => generateLoginCode());
    expect(codes.some((code) => code.startsWith("0"))).toBe(true);
  });

  it("el hash no contiene el código", () => {
    const code = "123456";
    vi.stubEnv("SESSION_SECRET", "local-unit-test-session-secret-0123456789");
    const hash = hashLoginCode(1, code);
    expect(hash).not.toContain(code);
    expect(hash).toHaveLength(64);
    // Determinista, que es lo que permite buscar por hash.
    expect(hashLoginCode(1, code)).toBe(hash);
    expect(hashLoginCode(1, "123457")).not.toBe(hash);
  });

  it("el mensaje trae el código y avisa que vence", () => {
    const body = loginCodeMessage("123456");
    expect(body).toContain("123456");
    expect(body).toContain("10 minutos");
    // Y le dice qué hacer a quien no lo pidió.
    expect(body.toLowerCase()).toContain("si no lo pediste");
  });
});

describe("el sender de consola", () => {
  it("imprime y no explota", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await createConsoleSender().send({ to: "+595981123456", body: "hola" });
    expect(log).toHaveBeenCalled();
  });
});
