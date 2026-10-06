import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REDACTED,
  currentRequestId,
  formatLine,
  log,
  mensajeDe,
  withRequestContext,
} from "@/lib/log";

/**
 * El logger (O8, plan-operacion §5.4 C).
 *
 * La mitad de este archivo es sobre la **redacción**, y no es paranoia: un log
 * en Hostinger lo lee cualquiera con acceso al hPanel. El teléfono de una
 * compradora en un log es una filtración aunque nadie la mire, y la única
 * defensa que no depende de que cada llamador se acuerde es que el logger
 * mismo se niegue a imprimir esos campos.
 */

afterEach(() => vi.restoreAllMocks());

function parse(linea: string): Record<string, unknown> {
  return JSON.parse(linea) as Record<string, unknown>;
}

describe("formatLine", () => {
  it("una línea JSON con ts, level y msg", () => {
    const salida = parse(formatLine("info", "algo pasó"));

    expect(salida.level).toBe("info");
    expect(salida.msg).toBe("algo pasó");
    expect(typeof salida.ts).toBe("string");
    expect(new Date(salida.ts as string).toString()).not.toBe("Invalid Date");
  });

  it("los campos se agregan tal cual", () => {
    const salida = parse(formatLine("info", "x", { pedidos: 3, ok: true }));
    expect(salida.pedidos).toBe(3);
    expect(salida.ok).toBe(true);
  });

  it("sin request, no hay reqId", () => {
    expect(parse(formatLine("info", "x")).reqId).toBeUndefined();
  });
});

describe("redacción", () => {
  // Los nombres que se ven de verdad en este repo.
  const PROHIBIDOS = [
    "phone",
    "customerPhone",
    "telefono",
    "token",
    "accessToken",
    "access_token",
    "secret",
    "CRON_SECRET",
    "password",
    "passwordHash",
    "authorization",
    "cookie",
    "apiKey",
    "body",
  ];

  for (const campo of PROHIBIDOS) {
    it(`redacta ${campo}`, () => {
      const salida = parse(
        formatLine("info", "x", { [campo]: "+595981123456" })
      );
      expect(salida[campo]).toBe(REDACTED);
    });
  }

  it("también adentro de un objeto anidado", () => {
    // Un `{ order: { phone } }` filtra igual que un `{ phone }`.
    const salida = parse(
      formatLine("info", "x", { order: { id: 1, phone: "+595981123456" } })
    );
    expect((salida.order as Record<string, unknown>).phone).toBe(REDACTED);
    expect((salida.order as Record<string, unknown>).id).toBe(1);
  });

  it("y adentro de un array", () => {
    const salida = parse(
      formatLine("info", "x", { avisos: [{ phone: "+595981123456" }] })
    );
    expect((salida.avisos as Array<Record<string, unknown>>)[0]?.phone).toBe(
      REDACTED
    );
  });

  it("lo que no es sensible pasa entero", () => {
    const salida = parse(
      formatLine("info", "x", { orderNumber: "PY-000042", total: 150000 })
    );
    expect(salida.orderNumber).toBe("PY-000042");
    expect(salida.total).toBe(150_000);
  });

  it("un Error se resume, no se vuelca con stack", () => {
    const salida = parse(
      formatLine("error", "x", { error: new Error("explotó") })
    );
    expect(salida.error).toEqual({ name: "Error", message: "Error" });
  });

  it("una referencia cíclica no hace perder el evento", () => {
    const ciclico: Record<string, unknown> = { a: 1 };
    ciclico.yo = ciclico;

    const salida = parse(formatLine("info", "igual salgo", { ciclico }));
    expect(salida.msg).toBe("igual salgo");
  });
});

describe("reqId", () => {
  it("viaja solo en cada línea de adentro del request", () => {
    // Sin esto habría que pasarlo a mano, y la primera función de dominio que
    // se olvidara dejaría un hueco justo en el camino que más importa seguir.
    withRequestContext({ reqId: "abc123def" }, () => {
      expect(currentRequestId()).toBe("abc123def");
      expect(parse(formatLine("info", "x")).reqId).toBe("abc123def");
    });

    expect(currentRequestId()).toBeUndefined();
  });

  it("sobrevive a un await adentro del request", () => {
    return withRequestContext({ reqId: "abc123def" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(currentRequestId()).toBe("abc123def");
    });
  });
});

describe("salida", () => {
  it("info va a stdout y warn/error a stderr", () => {
    // En Hostinger stdout y stderr se leen por separado, y lo que hay que
    // mirar primero es lo que salió mal.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    log.info("a");
    log.warn("b");
    log.error("c");

    expect(info).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(2);
  });
});

describe("mensajeDe", () => {
  it("el mensaje del error, sin el stack", () => {
    expect(mensajeDe(new Error("se cayó"))).toBe("Error");
    expect(mensajeDe("un string")).toBe("Error");
    expect(mensajeDe(null)).toBe("Error");
  });
});
