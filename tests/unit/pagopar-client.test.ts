import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  iniciarTransaccion,
  INICIAR_TRANSACCION_PATH,
  pagoparDateTime,
  PagoparRequestError,
  type IniciarTransaccionInput,
  type PagoparRequestOptions,
} from "../../src/domain/pagopar/client";
import type { PagoparConfig } from "../../src/domain/pagopar/config";
import { PagoparProtocolError } from "../../src/domain/pagopar/protocol";

const CONFIG: PagoparConfig = {
  publicKey: "publica-de-prueba",
  privateKey: "privada-de-prueba",
  baseUrl: "https://pagopar.example/base",
};

const HASH = "b92a3c6e319f08e49500328cbd342db19cf1cf07eab118414716a5f66d20cee3";

const INPUT: IniciarTransaccionInput = {
  orderNumber: "PY-000123",
  totalPyg: 150000,
  descripcion: "Pedido PY-000123",
  comprador: { nombre: "Ana López", telefono: "+595981123456", ciudad: "Asunción" },
  items: [{ sku: "SKU-1", nombre: "Yerba", cantidad: 2, precioPyg: 75000, totalPyg: 150000 }],
  fechaMaximaPago: new Date("2026-08-08T15:00:00Z"),
};

type Call = { url: string; body: Record<string, unknown> };

/** `fetch` de mentira: devuelve las respuestas de la lista, en orden. */
function stubFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    const next = responses[calls.length - 1] ?? responses[responses.length - 1];
    if (next instanceof Error) throw next;
    return next as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Sin esperas reales y sin azar: los tests miden decisiones, no relojes. */
function options(fetchImpl: typeof fetch, extra: PagoparRequestOptions = {}) {
  const waits: number[] = [];
  return {
    waits,
    value: {
      config: CONFIG,
      fetchImpl,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      random: () => 0.5,
      ...extra,
    } satisfies PagoparRequestOptions,
  };
}

describe("iniciarTransaccion", () => {
  it("pega al path de la doc sobre PAGOPAR_BASE_URL", async () => {
    const { impl, calls } = stubFetch([ok({ respuesta: true, resultado: [{ data: HASH }] })]);

    await iniciarTransaccion(INPUT, options(impl).value);

    expect(calls[0]?.url).toBe(`${CONFIG.baseUrl}${INICIAR_TRANSACCION_PATH}`);
  });

  it("firma con sha1(private + order_number + total) y manda el total entero", async () => {
    const { impl, calls } = stubFetch([ok({ respuesta: true, resultado: [{ data: HASH }] })]);

    await iniciarTransaccion(INPUT, options(impl).value);

    const body = calls[0]?.body ?? {};
    expect(body.token).toBe(
      createHash("sha1").update(`${CONFIG.privateKey}PY-000123150000`, "utf8").digest("hex")
    );
    // El total, en el hash y en el cuerpo, es el mismo string entero.
    expect(body.monto_total).toBe("150000");
    expect(JSON.stringify(body)).not.toContain("150000.00");
  });

  it("devuelve el hash_pedido y el sobre completo", async () => {
    const envelope = { respuesta: true, resultado: [{ data: HASH, pedido: "PY-000123" }] };
    const { impl } = stubFetch([ok(envelope)]);

    const result = await iniciarTransaccion(INPUT, options(impl).value);

    expect(result.hashPedido).toBe(HASH);
    expect(result.envelope).toEqual(envelope);
  });

  it("propaga el error cuando Pagopar contesta respuesta:false", async () => {
    const { impl } = stubFetch([ok({ respuesta: false, resultado: "token inválido" })]);

    await expect(iniciarTransaccion(INPUT, options(impl).value)).rejects.toThrow(
      PagoparProtocolError
    );
  });
});

describe("timeout y reintentos", () => {
  it("reintenta ante un corte de red y termina bien", async () => {
    const { impl, calls } = stubFetch([
      new Error("ECONNRESET"),
      ok({ respuesta: true, resultado: [{ data: HASH }] }),
    ]);
    const opts = options(impl);

    const result = await iniciarTransaccion(INPUT, opts.value);

    expect(result.hashPedido).toBe(HASH);
    expect(calls).toHaveLength(2);
  });

  it("reintenta ante un 5xx y se rinde después de `attempts`", async () => {
    const { impl, calls } = stubFetch([ok({}, 502)]);
    const opts = options(impl, { attempts: 3 });

    await expect(iniciarTransaccion(INPUT, opts.value)).rejects.toThrow(PagoparRequestError);
    expect(calls).toHaveLength(3);
  });

  it("NO reintenta ante un 4xx: el pedido está mal armado", async () => {
    const { impl, calls } = stubFetch([ok({}, 400)]);

    await expect(iniciarTransaccion(INPUT, options(impl).value)).rejects.toThrow(
      PagoparRequestError
    );
    expect(calls).toHaveLength(1);
  });

  it("NO reintenta un JSON que no entendemos", async () => {
    const { impl, calls } = stubFetch([ok({ cualquier: "cosa" })]);

    await expect(iniciarTransaccion(INPUT, options(impl).value)).rejects.toThrow(
      PagoparProtocolError
    );
    expect(calls).toHaveLength(1);
  });

  it("la espera crece exponencialmente y pasa por el jitter", async () => {
    const { impl } = stubFetch([ok({}, 500)]);
    const opts = options(impl, { attempts: 4, baseDelayMs: 100, maxDelayMs: 1000 });

    await expect(iniciarTransaccion(INPUT, opts.value)).rejects.toThrow(PagoparRequestError);

    // random() = 0.5 → la mitad de 100, 200 y 400.
    expect(opts.waits).toEqual([50, 100, 200]);
  });

  it("con jitter completo, dos clientes no reintentan en el mismo milisegundo", async () => {
    const impares = options(stubFetch([ok({}, 500)]).impl, { attempts: 2, baseDelayMs: 1000 });
    impares.value.random = () => 0.1;
    const pares = options(stubFetch([ok({}, 500)]).impl, { attempts: 2, baseDelayMs: 1000 });
    pares.value.random = () => 0.9;

    await expect(iniciarTransaccion(INPUT, impares.value)).rejects.toThrow();
    await expect(iniciarTransaccion(INPUT, pares.value)).rejects.toThrow();

    expect(impares.waits).toEqual([100]);
    expect(pares.waits).toEqual([900]);
    expect(impares.waits).not.toEqual(pares.waits);
  });

  it("cada intento lleva su propio corte de tiempo", async () => {
    let signal: AbortSignal | undefined;
    const impl = (async (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return ok({ respuesta: true, resultado: [{ data: HASH }] });
    }) as unknown as typeof fetch;

    await iniciarTransaccion(INPUT, options(impl, { timeoutMs: 1234 }).value);

    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe("pagoparDateTime", () => {
  // Paraguay eliminó el horario de verano en 2024: UTC-3 todo el año. El
  // offset sale de la tzdata de Node, no de un -3 hardcodeado en el código.
  it("formatea en hora de Asunción, no en UTC", () => {
    expect(pagoparDateTime(new Date("2026-08-08T15:00:00Z"))).toBe("2026-08-08 12:00:00");
  });

  it("un pedido de las 22:00 de Asunción no salta de día", () => {
    // En UTC ya es el 9; en Asunción sigue siendo el 8.
    expect(pagoparDateTime(new Date("2026-08-09T01:00:00Z"))).toBe("2026-08-08 22:00:00");
  });

  it("la medianoche es 00, no 24", () => {
    expect(pagoparDateTime(new Date("2026-08-08T03:00:00Z"))).toBe("2026-08-08 00:00:00");
  });
});
