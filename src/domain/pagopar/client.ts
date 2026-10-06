import { PY_TIMEZONE } from "@/lib/py";

import { pagoparConfig, type PagoparConfig } from "./config";
import { pagoparAmount, requestToken } from "./hash";
import { mockPagoparFetch } from "./mock";
import { isPagoparMockMode } from "./mode";
import {
  extractHashPedido,
  parseEnvelope,
  PagoparProtocolError,
  type PagoparEnvelope,
} from "./protocol";

/**
 * Cliente de Pagopar — `iniciar-transaccion` (PLAN.md 5.1).
 *
 * Todo lo que sale de acá lleva el token `sha1(PRIVATE_KEY + order_number +
 * total)` con el total como **string entero exacto** (ver `pagoparAmount`).
 *
 * El path viene de ARCH.md §4; el host sale de `PAGOPAR_BASE_URL` y no tiene
 * default (config.ts explica por qué).
 */

export const INICIAR_TRANSACCION_PATH = "/api/comercios/2.0/iniciar-transaccion";

// ---------------------------------------------------------------------------
// Tipos del request
// ---------------------------------------------------------------------------

export type PagoparItem = {
  /** SKU o id interno; Pagopar sólo lo devuelve, no lo interpreta. */
  sku: string;
  nombre: string;
  cantidad: number;
  /** Guaraníes enteros. */
  precioPyg: number;
  /** Guaraníes enteros: `precioPyg × cantidad`. */
  totalPyg: number;
};

export type PagoparBuyer = {
  nombre: string;
  /** `+5959XXXXXXXX`. */
  telefono: string;
  email?: string | null;
  /** RUC o CI ya normalizado. */
  documento?: string | null;
  tipoDocumento?: "RUC" | "CI" | null;
  ciudad?: string | null;
  direccion?: string | null;
};

export type IniciarTransaccionInput = {
  /** `orders.order_number` — el número humano, nunca el id interno. */
  orderNumber: string;
  /** `orders.total_pyg`. Entero. */
  totalPyg: number;
  descripcion: string;
  comprador: PagoparBuyer;
  items: readonly PagoparItem[];
  /** Hasta cuándo se puede pagar: `orders.reserved_until`. */
  fechaMaximaPago: Date;
};

export type IniciarTransaccionResult = {
  hashPedido: string;
  /** El sobre completo, para guardarlo en `payments.raw_payload`. */
  envelope: PagoparEnvelope;
};

// ---------------------------------------------------------------------------
// Opciones de red
// ---------------------------------------------------------------------------

export type PagoparRequestOptions = {
  config?: PagoparConfig;
  fetchImpl?: typeof fetch;
  /** Corte por intento. Pagopar contesta rápido o no contesta. */
  timeoutMs?: number;
  /** Intentos totales, no reintentos. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Inyectable para que los tests no dependan del azar. */
  random?: () => number;
};

const DEFAULTS = {
  timeoutMs: 8_000,
  attempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 4_000,
} as const;

export class PagoparRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly attempts?: number
  ) {
    super(message);
    this.name = "PagoparRequestError";
  }
}

// ---------------------------------------------------------------------------
// iniciar-transaccion
// ---------------------------------------------------------------------------

/**
 * Abre la transacción y devuelve el `hash_pedido`, que es la llave con la que
 * después reconocemos el webhook de este pedido.
 *
 * Los nombres de los campos salen de la doc 2.0 de Pagopar. Los montos van
 * como string entero por la misma razón que el hash: un `"150000.00"` acá
 * hace que el total no coincida con el firmado.
 */
export async function iniciarTransaccion(
  input: IniciarTransaccionInput,
  options: PagoparRequestOptions = {}
): Promise<IniciarTransaccionResult> {
  const config = options.config ?? pagoparConfig();

  const body = {
    token: requestToken(config.privateKey, input.orderNumber, input.totalPyg),
    token_publico: config.publicKey,
    monto_total: pagoparAmount(input.totalPyg),
    tipo_pedido: "VENTA-COMERCIO",
    id_pedido_comercio: input.orderNumber,
    descripcion: input.descripcion,
    fecha_maxima_pago: pagoparDateTime(input.fechaMaximaPago),
    comprador: {
      nombre: input.comprador.nombre,
      telefono: input.comprador.telefono,
      email: input.comprador.email ?? "",
      documento: input.comprador.documento ?? "",
      tipo_documento: input.comprador.tipoDocumento ?? "CI",
      ciudad: input.comprador.ciudad ?? "",
      direccion: input.comprador.direccion ?? "",
    },
    compras_items: input.items.map((item) => ({
      ciudad: input.comprador.ciudad ?? "",
      nombre: item.nombre,
      cantidad: item.cantidad,
      categoria: "909",
      public_key: config.publicKey,
      url_imagen: "",
      descripcion: item.nombre,
      id_producto: item.sku,
      precio_total: pagoparAmount(item.totalPyg),
      vendedor_telefono: "",
      vendedor_direccion: "",
      vendedor_datos_adicionales: "",
    })),
  };

  const envelope = await postJson(
    `${config.baseUrl}${INICIAR_TRANSACCION_PATH}`,
    body,
    options
  );

  return { hashPedido: extractHashPedido(envelope), envelope };
}

/** `YYYY-MM-DD HH:mm:ss` en hora de Asunción, que es como la espera Pagopar. */
export function pagoparDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";

  // `hour12: false` devuelve "24" a la medianoche en algunas versiones de ICU.
  const hour = get("hour") === "24" ? "00" : get("hour");

  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")}`;
}

// ---------------------------------------------------------------------------
// POST con timeout y reintentos con jitter
// ---------------------------------------------------------------------------

/**
 * Reintenta sólo lo que tiene sentido reintentar: cortes de red, timeouts y
 * 5xx. Un 4xx es un pedido mal armado y repetirlo diez veces no lo arregla.
 *
 * La espera lleva **jitter completo** (`random() × backoff`) y no un backoff
 * pelado: si el checkout de Pagopar se cae un minuto, todos los pedidos que
 * estaban esperando reintentan exactamente al mismo milisegundo y le tiran el
 * servicio otra vez justo cuando vuelve.
 */
async function postJson(
  url: string,
  body: unknown,
  options: PagoparRequestOptions
): Promise<PagoparEnvelope> {
  // El modo mock (`PAGOPAR_MODE=mock`, jamás en producción) cambia esto y nada
  // más: el cuerpo, el token `sha1(PRIVATE_KEY + order_number + total)`, el
  // timeout, los reintentos y el parseo del sobre siguen siendo los de siempre.
  // Un `fetchImpl` explícito gana igual, para no pisar los tests.
  const fetchImpl =
    options.fetchImpl ?? (isPagoparMockMode() ? mockPagoparFetch : globalThis.fetch);
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const attempts = Math.max(1, options.attempts ?? DEFAULTS.attempts);
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  const payload = JSON.stringify(body);
  let lastError: PagoparRequestError | undefined;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status >= 500) {
        throw new PagoparRequestError(`Pagopar respondió ${response.status}`, response.status);
      }
      if (!response.ok) {
        // 4xx: error nuestro. Se corta acá, sin reintentar.
        throw new NonRetryableError(
          new PagoparRequestError(`Pagopar respondió ${response.status}`, response.status)
        );
      }

      return parseEnvelope(await response.json());
    } catch (error) {
      if (error instanceof NonRetryableError) throw error.cause;
      // Un JSON que no entendemos no mejora reintentando.
      if (error instanceof PagoparProtocolError) throw error;

      lastError = asRequestError(error);
      if (attempt === attempts) break;

      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(Math.round(random() * backoff));
    }
  }

  throw new PagoparRequestError(
    `No pude hablar con Pagopar después de ${attempts} intentos: ${lastError?.message ?? "error desconocido"}`,
    lastError?.status,
    attempts
  );
}

class NonRetryableError extends Error {
  constructor(readonly cause: PagoparRequestError) {
    super(cause.message);
    this.name = "NonRetryableError";
  }
}

function asRequestError(error: unknown): PagoparRequestError {
  if (error instanceof PagoparRequestError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new PagoparRequestError(message);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
