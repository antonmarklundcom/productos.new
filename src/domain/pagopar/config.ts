/**
 * Configuración de Pagopar, leída del servidor: `/admin/integraciones` o, si
 * no, el entorno de siempre (`src/lib/integraciones.ts`).
 *
 * Ninguna de estas variables lleva `NEXT_PUBLIC_`: `PAGOPAR_PRIVATE_KEY` firma
 * el token de cada petición y el guard del webhook. Si se filtra, cualquiera
 * puede iniciar transacciones a nombre del comercio **y** falsificar avisos de
 * pago. Nunca se loguea, ni entera ni truncada.
 *
 * `PAGOPAR_BASE_URL` no tiene default a propósito. Poner una URL "por si
 * acaso" es la forma de mandarle los datos del comercio a un host equivocado:
 * el valor sale de la doc de Pagopar y se configura en el `.env`, no acá.
 *
 * Con `PAGOPAR_MODE=mock` (nunca en producción, ver `mode.ts`) las tres salen
 * del simulador en vez del entorno: es lo que permite demostrar el ciclo
 * completo sin una cuenta de Pagopar. El mock gana sobre lo que haya en el
 * `.env`; si están las credenciales reales igual no se usan, que es lo que uno
 * quiere de un modo llamado "mock".
 */

import { integracion } from "@/lib/integraciones";

import { MOCK_PRIVATE_KEY, mockCheckoutUrl, mockPagoparConfig } from "./mock";
import { isPagoparMockMode } from "./mode";

export type PagoparConfig = {
  publicKey: string;
  privateKey: string;
  /** Sin barra final. */
  baseUrl: string;
};

export class PagoparNotConfiguredError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`Faltan variables de Pagopar: ${missing.join(", ")}`);
    this.name = "PagoparNotConfiguredError";
  }
}

/**
 * Las tres credenciales, de `/admin/integraciones` → Pagopar o del entorno de
 * siempre (`src/lib/integraciones.ts`). Van juntas: si el panel tiene alguna,
 * las tres salen del panel — nunca la clave privada de una cuenta con la URL
 * de otra. La lógica de abajo (qué falta, el mock, la firma) no cambió.
 */
function read(name: "PAGOPAR_PUBLIC_KEY" | "PAGOPAR_PRIVATE_KEY" | "PAGOPAR_BASE_URL"): string {
  const { valores } = integracion("pagopar");
  const valor =
    name === "PAGOPAR_PUBLIC_KEY"
      ? valores.publicKey
      : name === "PAGOPAR_PRIVATE_KEY"
        ? valores.privateKey
        : valores.baseUrl;
  return (valor ?? "").trim();
}

/**
 * Config completa — la necesita el cliente que llama a la API.
 *
 * Tira si falta algo: preferimos un checkout que no arranca a uno que arranca
 * y deja pedidos colgados esperando un pago que nunca se pudo iniciar.
 */
export function pagoparConfig(): PagoparConfig {
  if (isPagoparMockMode()) return mockPagoparConfig();

  const publicKey = read("PAGOPAR_PUBLIC_KEY");
  const privateKey = read("PAGOPAR_PRIVATE_KEY");
  const baseUrl = read("PAGOPAR_BASE_URL").replace(/\/+$/, "");

  const missing: string[] = [];
  if (publicKey === "") missing.push("PAGOPAR_PUBLIC_KEY");
  if (privateKey === "") missing.push("PAGOPAR_PRIVATE_KEY");
  if (baseUrl === "") missing.push("PAGOPAR_BASE_URL");
  if (missing.length > 0) throw new PagoparNotConfiguredError(missing);

  return { publicKey, privateKey, baseUrl };
}

/**
 * Sólo la clave privada.
 *
 * El webhook no necesita ni la pública ni la URL base: sólo verifica una firma.
 * Que pueda seguir validando aunque falte el resto de la config es deseable —
 * un pago que ya ocurrió tiene que poder confirmarse.
 */
export function pagoparPrivateKey(): string | null {
  // En modo mock la ruta valida avisos firmados por el simulador. La ruta no
  // sabe nada de esto: sigue pidiendo "la clave privada" y comparando en
  // tiempo constante como siempre.
  if (isPagoparMockMode()) return MOCK_PRIVATE_KEY;

  const privateKey = read("PAGOPAR_PRIVATE_KEY");
  return privateKey === "" ? null : privateKey;
}

/** Para que el checkout pueda ofrecer o no el método "tarjeta". */
export function isPagoparConfigured(): boolean {
  try {
    pagoparConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * URL de la página de pago alojada por Pagopar para un `hash_pedido` dado.
 *
 * ⚠️ Igual que `webhookResponseBody()` en `protocol.ts`: no hay acceso a la
 * doc v2 vigente para confirmar si la página de pago vive en el mismo host
 * que la API (`PAGOPAR_BASE_URL`) bajo `/pagos/{hash_pedido}` — el patrón
 * público más común de Pagopar — o en un host de checkout separado. Se usa
 * `PAGOPAR_BASE_URL` por ser lo único configurado; confirmar contra la doc
 * y el sandbox antes de cobrar de verdad, y ajustar sólo esta función si el
 * host difiere.
 */
export function pagoparCheckoutUrl(hashPedido: string, config: PagoparConfig = pagoparConfig()): string {
  // En modo mock la "página de pago" es una ruta interna de esta misma app
  // (`/dev/pagopar/...`), no una URL externa: el formulario del checkout la
  // navega con el router en vez de mandar el navegador afuera.
  if (isPagoparMockMode()) return mockCheckoutUrl(hashPedido);

  return `${config.baseUrl}/pagos/${encodeURIComponent(hashPedido)}`;
}
