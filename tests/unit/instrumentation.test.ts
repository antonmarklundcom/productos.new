import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cuerpoDelReporte,
  errorReportUrl,
  onRequestError,
  resetErrorReportLimitForTests,
} from "@/instrumentation";

/**
 * El reporte de errores (O8, plan-operacion §5.4 D).
 *
 * La regla que este archivo fija es una sola y es la que importa: **sin
 * `ERROR_REPORT_URL`, no sale nada de la máquina**. No hay telemetría anónima,
 * no hay un default "por si acaso", no hay un SDK que decida por su cuenta.
 */

beforeEach(() => {
  vi.unstubAllEnvs();
  resetErrorReportLimitForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function silenciarLogs(): void {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
}

describe("errorReportUrl", () => {
  it("sin la variable, null", () => {
    expect(errorReportUrl()).toBeNull();
  });

  it("vacía cuenta como sin configurar", () => {
    vi.stubEnv("ERROR_REPORT_URL", "   ");
    expect(errorReportUrl()).toBeNull();
  });

  it("acepta https", () => {
    vi.stubEnv("ERROR_REPORT_URL", "https://hooks.slack.com/services/x");
    expect(errorReportUrl()).toBe("https://hooks.slack.com/services/x");
  });

  it("rechaza http: el reporte lleva el mapa interno del servidor", () => {
    silenciarLogs();
    vi.stubEnv("ERROR_REPORT_URL", "http://hooks.slack.com/x");
    expect(errorReportUrl()).toBeNull();
  });

  it("rechaza una URL inválida en vez de reventar en cada error", () => {
    silenciarLogs();
    vi.stubEnv("ERROR_REPORT_URL", "no soy una url");
    expect(errorReportUrl()).toBeNull();
  });
});

describe("cuerpoDelReporte", () => {
  it("lleva lo justo y nada más", () => {
    const cuerpo = JSON.parse(
      cuerpoDelReporte(new Error("explotó"), {
        path: "/api/x",
        method: "POST",
        reqId: "r1",
      })
    ) as Record<string, unknown>;

    expect(Object.keys(cuerpo).sort()).toEqual(
      ["message", "method", "path", "reqId", "sha", "stack"].sort()
    );
    expect(cuerpo.message).toBe("Error");
    expect(cuerpo.path).toBe("/api/x");
  });

  it("recorta el stack: en un webhook nadie lee cuatro mil líneas", () => {
    const error = new Error("x");
    error.stack = "y".repeat(10_000);

    const cuerpo = JSON.parse(cuerpoDelReporte(error, {})) as { stack: string };
    expect(cuerpo.stack).toBeUndefined();
  });

  it("un error que no es Error tampoco rompe", () => {
    const cuerpo = JSON.parse(cuerpoDelReporte("un string suelto", {})) as {
      message: string;
    };
    expect(cuerpo.message).toBe("Error");
  });
});

describe("onRequestError", () => {
  it("sin URL configurada NO hace ningún fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    silenciarLogs();

    await onRequestError(new Error("x"), { path: "/api/x", method: "GET" });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("siempre deja la línea de log, con o sin URL", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await onRequestError(new Error("explotó"), {
      path: "/api/x",
      method: "GET",
    });

    expect(error).toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).toContain("request falló");
  });

  it("con URL, hace el POST", async () => {
    vi.stubEnv("ERROR_REPORT_URL", "https://hooks.example.com/x");
    silenciarLogs();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await onRequestError(new Error("x"), { path: "/api/x", method: "GET" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://hooks.example.com/x");
    expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
  });

  it("el webhook caído no propaga el error", async () => {
    // Corre en el camino de un error que ya pasó: hacerlo fallar de nuevo sólo
    // taparía el original.
    vi.stubEnv("ERROR_REPORT_URL", "https://hooks.example.com/x");
    silenciarLogs();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("sin red"));

    await expect(
      onRequestError(new Error("x"), { path: "/api/x" })
    ).resolves.toBeUndefined();
  });

  it("el rate limit corta la tormenta de POSTs", async () => {
    // Una tormenta de errores —la base caída, cada request fallando— no puede
    // ser además una tormenta de POSTs: sumaría carga al servidor que ya está
    // sufriendo y el webhook del otro lado nos cortaría.
    vi.stubEnv("ERROR_REPORT_URL", "https://hooks.example.com/x");
    silenciarLogs();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    for (let i = 0; i < 25; i += 1) {
      await onRequestError(new Error(`x${i}`), { path: "/api/x" });
    }

    expect(fetchSpy.mock.calls.length).toBe(10);
  });

  it("el reqId del header viaja en el reporte", async () => {
    vi.stubEnv("ERROR_REPORT_URL", "https://hooks.example.com/x");
    silenciarLogs();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await onRequestError(new Error("x"), {
      path: "/api/x",
      method: "GET",
      headers: { "x-request-id": "req-abc" },
    });

    const cuerpo = JSON.parse(
      (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string
    ) as { reqId: string };
    expect(cuerpo.reqId).toBe("req-abc");
  });

  it("ni el log ni el reporte llevan la query: ahí viajan el token del pedido y el secreto del cron", async () => {
    vi.stubEnv("ERROR_REPORT_URL", "https://hooks.example.com/x");
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    // Next llena `path` con `req.url`: ruta **y** query.
    await onRequestError(new Error("x"), {
      path: "/pedido/PY-000123?t=token-secreto-del-pedido",
      method: "POST",
    });
    await onRequestError(new Error("y"), {
      path: "/api/cron/backup?secret=secreto-del-cron",
    });

    const salida = [
      ...logSpy.mock.calls.map((llamada) => llamada.map(String).join(" ")),
      ...fetchSpy.mock.calls.map((llamada) =>
        String((llamada[1] as RequestInit).body)
      ),
    ].join("\n");
    expect(salida).not.toContain("token-secreto-del-pedido");
    expect(salida).not.toContain("secreto-del-cron");
    expect(salida).toContain("/pedido/PY-000123");
    expect(salida).toContain("/api/cron/backup");
  });
});
