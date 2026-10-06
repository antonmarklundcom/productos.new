import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { iniciarTransaccion } from "../../src/domain/pagopar/client";
import {
  isPagoparConfigured,
  pagoparCheckoutUrl,
  pagoparConfig,
  pagoparPrivateKey,
  PagoparNotConfiguredError,
} from "../../src/domain/pagopar/config";
import * as mock from "../../src/domain/pagopar/mock";
import { isPagoparMockMode, PagoparMockInProductionError } from "../../src/domain/pagopar/mode";
import { listSourceFiles, readCode } from "../helpers/source";

/**
 * El candado del modo mock (`PAGOPAR_MODE=mock`, ver `src/domain/pagopar/mode.ts`).
 *
 * Una pasarela simulada corriendo en el sitio real marca pedidos como pagados
 * sin que haya entrado un guaraní. Este archivo es la prueba de que eso no
 * puede pasar, y lo verifica por los dos lados:
 *
 *   - **comportamiento**: con `NODE_ENV=production` el simulador no se elige
 *     solo (`isPagoparMockMode()` es `false`) y tampoco se puede forzar (cada
 *     función del simulador tira);
 *   - **código**: `PAGOPAR_MODE` se lee en un solo archivo, cada export del
 *     simulador pasa por el guard, y nadie importa `mock.ts` desde donde no
 *     corresponde.
 *
 * Lo primero solo se rompería en silencio el día que alguien agregue una
 * función al simulador y se olvide del guard; por eso está lo segundo.
 */

const PAGOPAR_DIR = path.join("src", "domain", "pagopar");
const MOCK_MODULE = path.join(PAGOPAR_DIR, "mock.ts");
const MODE_MODULE = path.join(PAGOPAR_DIR, "mode.ts");
const DEV_PAGE = path.join("src", "app", "dev", "pagopar", "[hash]", "page.tsx");
const SELF = path.join("tests", "unit", "pagopar-mock-mode.test.ts");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isPagoparMockMode()", () => {
  it("se enciende con PAGOPAR_MODE=mock fuera de producción", () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const value of ["mock", "MOCK", "  mock  "]) {
      vi.stubEnv("PAGOPAR_MODE", value);
      expect(isPagoparMockMode(), `PAGOPAR_MODE="${value}"`).toBe(true);
    }
  });

  it("está apagado sin la variable o con cualquier otro valor", () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const value of ["", "real", "sandbox", "mocked", "1"]) {
      vi.stubEnv("PAGOPAR_MODE", value);
      expect(isPagoparMockMode(), `PAGOPAR_MODE="${value}"`).toBe(false);
    }
  });

  it("está apagado en producción, cualquiera sea el valor de PAGOPAR_MODE", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const value of ["mock", "MOCK", "  mock  "]) {
      vi.stubEnv("PAGOPAR_MODE", value);
      expect(isPagoparMockMode(), `PAGOPAR_MODE="${value}"`).toBe(false);
    }
  });
});

describe("el simulador no se puede forzar en producción", () => {
  /**
   * Todas las funciones exportadas por `mock.ts` que hacen algo. Si mañana se
   * agrega una y no entra en esta lista, el test de código de más abajo
   * ("cada export pasa por el guard") es el que avisa.
   */
  const entryPoints: Record<string, () => unknown> = {
    mockPagoparConfig: () => mock.mockPagoparConfig(),
    mockCheckoutUrl: () => mock.mockCheckoutUrl("abc"),
    mockHashPedido: () => mock.mockHashPedido("PY-000123"),
    mockPagoparFetch: () => mock.mockPagoparFetch("https://pagopar.mock.invalid/x"),
    mockWebhookPayload: () => mock.mockWebhookPayload({ hashPedido: "abc", montoPyg: 1000 }),
    mockWebhookRequest: () => mock.mockWebhookRequest({ hashPedido: "abc", montoPyg: 1000 }),
    simulateMockPayment: () => mock.simulateMockPayment({ hashPedido: "abc", montoPyg: 1000 }),
  };

  it.each(Object.keys(entryPoints))(
    "%s() tira en producción aunque se la llame directo",
    async (name) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PAGOPAR_MODE", "mock");

      const call = entryPoints[name];
      await expect(Promise.resolve().then(() => call?.())).rejects.toBeInstanceOf(
        PagoparMockInProductionError
      );
    }
  );

  it("las mismas funciones sí corren fuera de producción", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PAGOPAR_MODE", "mock");

    // `simulateMockPayment` queda afuera: necesita base, y su camino feliz lo
    // cubre `tests/integration/pagopar-mock-flow.test.ts`.
    for (const [name, call] of Object.entries(entryPoints)) {
      if (name === "simulateMockPayment") continue;
      await expect(Promise.resolve().then(() => call())).resolves.toBeDefined();
    }
  });
});

describe("la configuración en producción ignora el modo mock", () => {
  it("pagoparConfig() exige las variables reales en vez de usar las de mentira", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAGOPAR_MODE", "mock");
    vi.stubEnv("PAGOPAR_PUBLIC_KEY", "");
    vi.stubEnv("PAGOPAR_PRIVATE_KEY", "");
    vi.stubEnv("PAGOPAR_BASE_URL", "");

    expect(() => pagoparConfig()).toThrow(PagoparNotConfiguredError);
    // Y el checkout no ofrece tarjeta, igual que sin configurar.
    expect(isPagoparConfigured()).toBe(false);
  });

  it("el webhook no acepta la clave privada del simulador", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAGOPAR_MODE", "mock");
    vi.stubEnv("PAGOPAR_PRIVATE_KEY", "");

    // `null` es lo que hace que la ruta conteste 503 en vez de validar avisos
    // firmados con una clave pública y commiteada.
    expect(pagoparPrivateKey()).toBeNull();

    vi.stubEnv("NODE_ENV", "development");
    expect(pagoparPrivateKey()).toBe(mock.MOCK_PRIVATE_KEY);
  });

  it("la URL de pago sigue siendo la de Pagopar, no la pantalla de demo", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAGOPAR_MODE", "mock");
    vi.stubEnv("PAGOPAR_PUBLIC_KEY", "pk");
    vi.stubEnv("PAGOPAR_PRIVATE_KEY", "sk");
    vi.stubEnv("PAGOPAR_BASE_URL", "https://api.pagopar.example");

    const url = pagoparCheckoutUrl("hash-123");
    expect(url).toBe("https://api.pagopar.example/pagos/hash-123");
    expect(url).not.toContain(mock.MOCK_CHECKOUT_PATH);
  });
});

describe("el cliente en producción sale a la red de verdad", () => {
  it("usa el fetch global y el host configurado, no el simulador", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAGOPAR_MODE", "mock");
    vi.stubEnv("PAGOPAR_PUBLIC_KEY", "pk");
    vi.stubEnv("PAGOPAR_PRIVATE_KEY", "sk");
    vi.stubEnv("PAGOPAR_BASE_URL", "https://api.pagopar.example");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          respuesta: true,
          resultado: [{ hash_pedido: "real-hash" }],
        }),
        {
          headers: { "content-type": "application/json" },
        }
      )
    );

    const result = await iniciarTransaccion({
      orderNumber: "PY-000123",
      totalPyg: 150_000,
      descripcion: "Pedido PY-000123",
      comprador: { nombre: "Ana", telefono: "+595981123456" },
      items: [
        {
          sku: "SKU-1",
          nombre: "Yerba",
          cantidad: 1,
          precioPyg: 150_000,
          totalPyg: 150_000,
        },
      ],
      fechaMaximaPago: new Date("2026-01-01T12:00:00Z"),
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("https://api.pagopar.example");
    // El hash es el que contestó el host real, no uno inventado por el
    // simulador: en producción `mockPagoparFetch` ni siquiera se elige.
    expect(result.hashPedido).toBe("real-hash");
  });
});

describe("guardarraíles de código", () => {
  it("PAGOPAR_MODE se lee en un solo archivo", async () => {
    const offenders: string[] = [];

    // Sólo el código que corre; los tests sí encienden y apagan la variable.
    for (const file of await listSourceFiles(["src", "scripts"])) {
      if (file === MODE_MODULE || file === SELF) continue;
      const code = await readCode(file);
      if (/process\.env(?:\.PAGOPAR_MODE|\[["']PAGOPAR_MODE["']\])/.test(code)) {
        offenders.push(file);
      }
    }

    // Cada lectura suelta de la variable es una decisión que se olvida del
    // guard de producción. La decisión vive en `isPagoparMockMode()`.
    expect(offenders).toEqual([]);
  });

  it("cada función exportada por mock.ts pasa por assertMockAllowed()", async () => {
    const code = await readCode(MOCK_MODULE);

    // `export const X: typeof fetch = async (...) =>` y `export function x(...)`.
    const exported = [
      ...code.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g),
      ...code.matchAll(/export\s+const\s+(\w+)\s*:\s*typeof\s+fetch/g),
    ].map(([, name]) => name);

    expect(exported.length).toBeGreaterThan(0);

    const offenders = exported.filter((name) => {
      // El cuerpo de la función: desde su firma hasta el próximo `export` de
      // primer nivel (o el final del archivo).
      const start = code.search(
        new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${name}\\b`)
      );
      const rest = code.slice(start + 1);
      const end = rest.search(/\nexport\s/);
      const body = end === -1 ? rest : rest.slice(0, end);
      return !body.includes("assertMockAllowed(");
    });

    expect(offenders).toEqual([]);
  });

  it("sólo el módulo de Pagopar y la pantalla de demo importan el simulador", async () => {
    const ALLOWED = new Set([
      MOCK_MODULE,
      path.join(PAGOPAR_DIR, "config.ts"),
      path.join(PAGOPAR_DIR, "client.ts"),
      DEV_PAGE,
    ]);

    const offenders: string[] = [];
    for (const file of await listSourceFiles(["src", "scripts"])) {
      if (ALLOWED.has(file)) continue;
      const code = await readCode(file);
      if (/from\s+["'](?:\.\/mock|.*\/domain\/pagopar\/mock)["']/.test(code)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("la pantalla de demo se cierra sola fuera del modo mock", async () => {
    const page = await readCode(DEV_PAGE);

    // 404 cuando el simulador está apagado — y en producción `isPagoparMockMode()`
    // es `false` siempre, así que el 404 es total.
    expect(page).toMatch(/if\s*\(!isPagoparMockMode\(\)\)\s*notFound\(\)/);
    // La server action es un endpoint POST propio: no alcanza con que la
    // página no se haya renderizado.
    expect(page).toContain("assertMockAllowed(");
  });
});
