import { assertGs, MoneyError } from "@/lib/money";

/**
 * El formato de cable de Pagopar, en un solo archivo.
 *
 * Todo lo que depende de cómo Pagopar arma sus JSON vive acá: el sobre de sus
 * respuestas, cómo viene el aviso de pago y —lo más delicado— **qué tenemos
 * que contestarle al webhook**.
 *
 * ⚠️ ARCH.md §4 avisa explícitamente que el sobre de la respuesta del webhook
 * cambió entre revisiones de la documentación, y que no hay que confiar en
 * ninguna forma recordada. Está todo concentrado en `webhookResponseBody()`
 * justamente para que confirmarlo contra la doc v2 vigente sea cambiar una
 * función y un test, no salir a buscar el JSON por todo el repo.
 * Ver `tests/integration/pagopar-sandbox.test.ts`.
 */

// ---------------------------------------------------------------------------
// Sobre de las respuestas DE Pagopar
// ---------------------------------------------------------------------------

/**
 * Las respuestas de la API 2.0 vienen envueltas así:
 *
 *   éxito: { "respuesta": true,  "resultado": [ { ... } ] }
 *   error: { "respuesta": false, "resultado": "mensaje de error" }
 */
export type PagoparEnvelope = {
  respuesta: boolean;
  resultado: unknown;
};

export class PagoparProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PagoparProtocolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEnvelope(body: unknown): PagoparEnvelope {
  if (!isRecord(body) || typeof body.respuesta !== "boolean") {
    throw new PagoparProtocolError("la respuesta de Pagopar no trae `respuesta`");
  }
  return { respuesta: body.respuesta, resultado: body.resultado };
}

/**
 * Saca el `hash_pedido` de la respuesta de `iniciar-transaccion`.
 *
 * Según la revisión de la doc el hash viene como `data` o como `hash_pedido`;
 * aceptamos ambos y exigimos que sea un string no vacío. Lo que no hacemos es
 * inventar un default: sin hash no hay forma de reconocer después el webhook
 * de este pedido, así que es un error duro.
 */
export function extractHashPedido(envelope: PagoparEnvelope): string {
  if (!envelope.respuesta) {
    throw new PagoparProtocolError(
      typeof envelope.resultado === "string"
        ? `Pagopar rechazó la transacción: ${envelope.resultado}`
        : "Pagopar rechazó la transacción"
    );
  }

  const first = Array.isArray(envelope.resultado) ? envelope.resultado[0] : envelope.resultado;
  if (!isRecord(first)) {
    throw new PagoparProtocolError("`resultado` no trae el pedido");
  }

  for (const key of ["hash_pedido", "data"] as const) {
    const value = first[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }

  throw new PagoparProtocolError("no encontré `hash_pedido` en la respuesta");
}

// ---------------------------------------------------------------------------
// Montos que llegan de afuera
// ---------------------------------------------------------------------------

/**
 * Convierte a guaraníes enteros un monto que mandó Pagopar.
 *
 * Nada de `parseFloat`: el monto es lo que decide si un pedido se marca pagado
 * y un float que redondea mal es plata regalada. Se aceptan sólo dos formas:
 *
 *   "150000"     → 150000   (lo que mandamos nosotros)
 *   "150000.00"  → 150000   (algún serializador le puso céntimos)
 *
 * Cualquier otra cosa se rechaza, incluido `"150.000"`: en es-PY eso son
 * ciento cincuenta mil guaraníes y en formato inglés son ciento cincuenta, y
 * adivinar cuál de las dos es un error que sólo se descubre en la conciliación.
 * Rechazar hace ruido; adivinar, no.
 */
export function parseAmountPyg(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new MoneyError(`monto con decimales: ${value}`);
    }
    return assertGs(value, "monto");
  }

  if (typeof value !== "string") {
    throw new MoneyError(`monto de tipo inesperado: ${typeof value}`);
  }

  const text = value.trim();
  //                enteros           céntimos en cero
  const match = /^(\d+)(?:[.,]0{1,2})?$/.exec(text);
  if (!match?.[1]) {
    throw new MoneyError(`monto con un formato que no puedo leer sin adivinar: "${text}"`);
  }

  return assertGs(Number(match[1]), "monto");
}

// ---------------------------------------------------------------------------
// El aviso de pago que llega al webhook
// ---------------------------------------------------------------------------

export type PagoparWebhookEvent = {
  hashPedido: string;
  pagado: boolean;
  montoPyg: number;
  /** El pedido tal cual llegó — se guarda en `payment_events.payload`. */
  raw: Record<string, unknown>;
};

/**
 * Pagopar postea el pedido envuelto en `resultado`, igual que sus respuestas.
 * Aceptamos también el objeto pelado: cuesta una línea y evita que una
 * revisión de la doc que saque el sobre nos deje sin cobrar.
 */
export function parseWebhookEvent(body: unknown): PagoparWebhookEvent {
  const pedido = webhookOrderNode(body);

  const hashPedido = pedido.hash_pedido;
  if (typeof hashPedido !== "string" || hashPedido.trim() === "") {
    throw new PagoparProtocolError("el aviso no trae `hash_pedido`");
  }

  if (!("monto" in pedido)) {
    throw new PagoparProtocolError("el aviso no trae `monto`");
  }

  return {
    hashPedido: hashPedido.trim(),
    pagado: parseBoolean(pedido.pagado),
    montoPyg: parseAmountPyg(pedido.monto),
    raw: pedido,
  };
}

function webhookOrderNode(body: unknown): Record<string, unknown> {
  if (Array.isArray(body)) {
    const first = body[0];
    if (isRecord(first)) return first;
    throw new PagoparProtocolError("el aviso llegó como una lista vacía");
  }

  if (!isRecord(body)) {
    throw new PagoparProtocolError("el aviso no es un objeto JSON");
  }

  if ("resultado" in body) {
    const resultado = body.resultado;
    const first = Array.isArray(resultado) ? resultado[0] : resultado;
    if (isRecord(first)) return first;
    throw new PagoparProtocolError("`resultado` no trae el pedido");
  }

  return body;
}

/**
 * `pagado` llega como booleano, como `"1"`/`"0"` o como `"true"`/`"false"`
 * según por dónde pase el JSON. Lo que **no** hacemos es tratar cualquier
 * string no vacío como verdadero: `"false"` es un string no vacío, y con esa
 * regla un aviso de pago fallido marcaría el pedido como cobrado.
 */
function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["1", "true", "si", "sí"].includes(text)) return true;
    if (["0", "false", "no", ""].includes(text)) return false;
  }
  if (value === undefined || value === null) return false;
  throw new PagoparProtocolError("no puedo interpretar `pagado`");
}

// ---------------------------------------------------------------------------
// Lo que le contestamos al webhook  ← el punto delicado
// ---------------------------------------------------------------------------

/**
 * Cuerpo de la respuesta al webhook.
 *
 * ⚠️ **Sin confirmar contra la doc v2 vigente.** ARCH.md §4 dice que este sobre
 * cambió entre revisiones y que no hay que confiar en ninguna forma recordada;
 * al escribir esto no había credenciales de sandbox ni acceso de red a la
 * documentación de Pagopar, así que quedó fijado lo único que sí está
 * documentado: el sobre `{respuesta, resultado}` que usa toda la API 2.0, con
 * el pedido recibido devuelto tal cual para que Pagopar pueda compararlo.
 *
 * Antes de cobrar de verdad: correr `tests/integration/pagopar-sandbox.test.ts`
 * con credenciales y ajustar **esta función** (y su test) si difiere. Es el
 * único lugar del repo que decide la forma de la respuesta.
 */
export function webhookResponseBody(event: PagoparWebhookEvent): PagoparEnvelope {
  return { respuesta: true, resultado: [event.raw] };
}

/**
 * ¿Se confirmó el sobre de arriba contra la doc v2 vigente y el sandbox?
 *
 * Es una constante y no una variable de entorno a propósito: confirmarlo es un
 * hecho sobre **el código**, no sobre el servidor donde corre. Cuando alguien
 * corra el test de sandbox con credenciales y verifique la forma, cambia este
 * `false` por `true` en el mismo commit en que ajusta `webhookResponseBody()`.
 *
 * `pnpm preflight` la lee y se niega a dar el visto bueno mientras siga en
 * `false`: es lo último que separa a la tienda de poder cobrar de verdad.
 */
export const WEBHOOK_ENVELOPE_CONFIRMED = false;

/** Errores, con el mismo sobre que usa Pagopar para los suyos. */
export function webhookErrorBody(code: string): PagoparEnvelope {
  return { respuesta: false, resultado: code };
}
