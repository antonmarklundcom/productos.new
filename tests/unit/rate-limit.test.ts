import { beforeEach, describe, expect, it } from "vitest";

import { clientIp, rateLimit, resetRateLimits } from "@/lib/rate-limit";

const OPTIONS = { limit: 5, windowMs: 15 * 60 * 1000 };

describe("rateLimit", () => {
  beforeEach(resetRateLimits);

  it("deja pasar hasta el límite y después corta", () => {
    const now = Date.now();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(
        rateLimit("ip:1.2.3.4", OPTIONS, now).ok,
        `intento ${attempt}`
      ).toBe(true);
    }
    const blocked = rateLimit("ip:1.2.3.4", OPTIONS, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("la limpieza periódica respeta la ventana de cada clave, no la de quien la dispara", () => {
    const largo = { limit: 3, windowMs: 15 * 60 * 1000 };
    const corto = { limit: 30, windowMs: 60 * 1000 };
    const start = Date.now();

    for (let i = 0; i < 3; i += 1) rateLimit("login:email:x", largo, start);
    expect(rateLimit("login:email:x", largo, start).ok).toBe(false);

    // Dos minutos después, una búsqueda pública (ventana de 60 s) dispara la
    // limpieza. Los intentos de login siguen dentro de sus 15 minutos.
    rateLimit("busqueda:1.2.3.4", corto, start + 2 * 60 * 1000);

    expect(
      rateLimit("login:email:x", largo, start + 2 * 60 * 1000 + 1).ok
    ).toBe(false);
  });

  it("cuenta por clave: una IP no bloquea a otra", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) rateLimit("ip:1.1.1.1", OPTIONS, now);

    expect(rateLimit("ip:1.1.1.1", OPTIONS, now).ok).toBe(false);
    expect(rateLimit("ip:2.2.2.2", OPTIONS, now).ok).toBe(true);
  });

  it("la ventana es deslizante: se libera de a un intento", () => {
    const start = Date.now();
    for (let i = 0; i < 5; i += 1)
      rateLimit("ip:9.9.9.9", OPTIONS, start + i * 1000);

    expect(rateLimit("ip:9.9.9.9", OPTIONS, start + 5000).ok).toBe(false);
    // Justo después de que vence el primer intento, entra uno más.
    expect(
      rateLimit("ip:9.9.9.9", OPTIONS, start + OPTIONS.windowMs + 1).ok
    ).toBe(true);
    // Pero no dos.
    expect(
      rateLimit("ip:9.9.9.9", OPTIONS, start + OPTIONS.windowMs + 2).ok
    ).toBe(false);
  });

  it("informa cuánto falta para reintentar", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) rateLimit("ip:8.8.8.8", OPTIONS, now);

    const blocked = rateLimit("ip:8.8.8.8", OPTIONS, now + 60_000);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(13 * 60);
  });
});

describe("clientIp", () => {
  it("toma la última IP de x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "200.1.2.3, 10.0.0.1, 10.0.0.2",
    });
    expect(clientIp(headers)).toBe("10.0.0.2");
  });

  it("cae a x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "190.0.0.9" }))).toBe(
      "190.0.0.9"
    );
  });

  it("sin headers devuelve un valor estable", () => {
    expect(clientIp(new Headers())).toBe("desconocida");
  });
});
