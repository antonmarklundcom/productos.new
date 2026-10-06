import { createHash } from "node:crypto";

import type { PagoparConfig } from "./config";
import { pagoparAmount, webhookGuardToken } from "./hash";
import { assertMockAllowed } from "./mode";

/**
 * Pasarela de Pagopar simulada, en memoria (`PAGOPAR_MODE=mock`).
 *
 * Existe para una sola cosa: poder mostrar el ciclo completo de un pedido con
 * tarjeta —checkout → aviso de pago → `pagado`— sin una cuenta de Pagopar, sin
 * credenciales y sin salir a la red. Es una herramienta de demo y de
 * desarrollo; el candado que impide que llegue a producción vive en `mode.ts`
 * y lo aplica **cada** función exportada de este archivo.
 *
 * La decisión de diseño importante es **dónde** se corta el camino real:
 *
 *   - en la ida se reemplaza únicamente el `fetch` (`mockPagoparFetch`). Todo
 *     lo demás del cliente sigue corriendo igual: el cuerpo que se arma, el
 *     `sha1(PRIVATE_KEY + order_number + total)`, el monto como entero exacto,
 *     el sobre `{respuesta, resultado}` y `extractHashPedido()`;
 *   - en la vuelta no se reemplaza nada. `simulateMockPayment()` postea un
 *     aviso firmado contra la **ruta real** `POST /api/webhooks/pagopar`, así
 *     que pasa por el guard de la firma, el rate limit, el `INSERT IGNORE` de
 *     idempotencia, la verificación de monto y `transitionOrder()`.
 *
 * O sea: lo simulado es la contraparte, no nuestro código. Un bug en el camino
 * del dinero se ve igual en modo mock que contra Pagopar de verdad — que es
 * justamente lo que hace que la demo sirva para algo.
 */

// ---------------------------------------------------------------------------
// Credenciales de mentira
// ---------------------------------------------------------------------------

/**
 * Nada de esto es un secreto ni se parece a uno: son constantes públicas,
 * commiteadas a propósito y evidentemente falsas. La clave "privada" del mock
 * sólo firma avisos que se procesan contra la base local.
 *
 * `.invalid` está reservado por RFC 2606 y no resuelve nunca: si algún día se
 * escapara un `fetch` real con esta config, falla en el DNS en vez de mandarle
 * los datos del comprador a un host de verdad.
 */
export const MOCK_PUBLIC_KEY = "pagopar-mock-public-key-no-es-un-secreto";
export const MOCK_PRIVATE_KEY = "pagopar-mock-private-key-no-es-un-secreto";
export const MOCK_BASE_URL = "https://pagopar.mock.invalid";

/** Página de la pasarela simulada, servida por esta misma app. */
export const MOCK_CHECKOUT_PATH = "/dev/pagopar";

/** Path de la ruta real del webhook, para armarle el `Request` al handler. */
const WEBHOOK_PATH = "/api/webhooks/pagopar";

export function mockPagoparConfig(): PagoparConfig {
  assertMockAllowed("mockPagoparConfig");
  return { publicKey: MOCK_PUBLIC_KEY, privateKey: MOCK_PRIVATE_KEY, baseUrl: MOCK_BASE_URL };
}

/** URL de la pasarela simulada para un `hash_pedido`. Es una ruta interna. */
export function mockCheckoutUrl(hashPedido: string): string {
  assertMockAllowed("mockCheckoutUrl");
  return `${MOCK_CHECKOUT_PATH}/${encodeURIComponent(hashPedido)}`;
}

// ---------------------------------------------------------------------------
// Ida: iniciar-transaccion sin red
// ---------------------------------------------------------------------------

/**
 * `hash_pedido` determinista a partir del número de pedido.
 *
 * Determinista y no aleatorio para que reintentar el checkout del mismo pedido
 * caiga en la misma fila de `payments` (`UNIQUE (provider, provider_ref)`),
 * igual que pasa con Pagopar, y para que el link de la demo se pueda volver a
 * abrir después de recargar.
 */
export function mockHashPedido(orderNumber: string): string {
  assertMockAllowed("mockHashPedido");
  return createHash("sha1").update(`pagopar-mock:${orderNumber}`, "utf8").digest("hex");
}

/**
 * `fetch` de mentira para el cliente de Pagopar.
 *
 * Se inyecta en `postJson()` (client.ts) y es el **único** punto donde el
 * camino de ida se aparta del real. Contesta con el mismo sobre de la API 2.0
 * para que `parseEnvelope()` y `extractHashPedido()` hagan su trabajo de
 * siempre.
 */
export const mockPagoparFetch: typeof fetch = async (input, init) => {
  assertMockAllowed("mockPagoparFetch");

  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  // El simulador conoce un solo endpoint. Si el cliente empieza a llamar a
  // otro, es mejor enterarse acá que recibir un sobre inventado.
  if (!url.includes("iniciar-transaccion")) {
    return jsonResponse({ respuesta: false, resultado: `endpoint no simulado: ${url}` }, 404);
  }

  const body = parseRequestBody(init?.body);
  const orderNumber = typeof body.id_pedido_comercio === "string" ? body.id_pedido_comercio : "";
  if (orderNumber === "") {
    // Mismo trato que le daría Pagopar a un pedido mal armado: 200 con
    // `respuesta: false`, que `extractHashPedido()` convierte en error.
    return jsonResponse({ respuesta: false, resultado: "falta id_pedido_comercio" }, 200);
  }

  return jsonResponse(
    {
      respuesta: true,
      resultado: [
        {
          hash_pedido: mockHashPedido(orderNumber),
          id_pedido_comercio: orderNumber,
          monto_total: body.monto_total ?? null,
          // Marca en `payments.raw_payload`: si un pedido de la base salió del
          // simulador, se ve sin tener que adivinarlo.
          pagopar_mock: true,
        },
      ],
    },
    200
  );
};

// ---------------------------------------------------------------------------
// Vuelta: el aviso de pago, contra la ruta real
// ---------------------------------------------------------------------------

export type MockWebhookInput = {
  hashPedido: string;
  /** Guaraníes enteros. Poner un valor distinto al total prueba el 409. */
  montoPyg: number;
  /** `false` simula un pago que no prosperó. */
  pagado?: boolean;
  /** Firma el aviso con una clave equivocada, para ver el 401 del guard. */
  firmaInvalida?: boolean;
  /** Se refleja en `x-forwarded-for`; el rate limit de la ruta lo usa. */
  ip?: string;
};

/**
 * El cuerpo del aviso, con la forma en que Pagopar lo postea: el pedido
 * envuelto en `resultado`, el monto como string entero y `pagado` como `"1"` o
 * `"0"` (protocol.ts documenta por qué no alcanza con un booleano).
 */
export function mockWebhookPayload(input: MockWebhookInput): Record<string, unknown> {
  assertMockAllowed("mockWebhookPayload");
  return {
    respuesta: true,
    resultado: [
      {
        hash_pedido: input.hashPedido,
        monto: pagoparAmount(input.montoPyg),
        pagado: input.pagado === false ? "0" : "1",
        forma_pago: "MOCK",
        pagopar_mock: true,
      },
    ],
  };
}

/**
 * El `Request` tal como llegaría de Pagopar, con el token del guard en el
 * querystring: `sha1(PRIVATE_KEY + hash_pedido)`.
 *
 * Se firma con `MOCK_PRIVATE_KEY`, que es exactamente la clave que
 * `pagoparPrivateKey()` le devuelve a la ruta en modo mock — por eso el guard
 * real valida el aviso simulado sin ninguna excepción metida en la ruta.
 */
export function mockWebhookRequest(input: MockWebhookInput): Request {
  assertMockAllowed("mockWebhookRequest");

  const url = new URL(`http://localhost${WEBHOOK_PATH}`);
  url.searchParams.set(
    "token",
    input.firmaInvalida
      ? webhookGuardToken("otra-clave-que-no-es-la-del-comercio", input.hashPedido)
      : webhookGuardToken(MOCK_PRIVATE_KEY, input.hashPedido)
  );

  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": input.ip ?? "127.0.0.1",
    },
    body: JSON.stringify(mockWebhookPayload(input)),
  });
}

export type MockWebhookResult = { status: number; body: unknown };

/**
 * Dispara el aviso de pago simulado contra la ruta real y devuelve lo que
 * contestó.
 *
 * La ruta se importa dinámicamente por dos razones: no arrastra el handler del
 * webhook a ningún bundle mientras el simulador esté apagado, y evita el ciclo
 * `route → config → mock → route`.
 */
export async function simulateMockPayment(input: MockWebhookInput): Promise<MockWebhookResult> {
  assertMockAllowed("simulateMockPayment");

  const { POST } = await import("@/app/api/webhooks/pagopar/route");
  const response = await POST(mockWebhookRequest(input));

  return { status: response.status, body: await response.json() };
}

// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parseRequestBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
