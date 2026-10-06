import { AsyncLocalStorage } from "node:async_hooks";
import { safeError } from "./safe-error";

/**
 * El logger del servidor (plan-operacion §5.4 C).
 *
 * Una línea JSON por evento, y nada más. No hay librería porque no hace falta:
 * lo que se necesita de un log en un hosting compartido es que se pueda
 * **grepear** desde el hPanel y que se pueda seguir un request de punta a
 * punta. Las dos cosas caben en `JSON.stringify` y en un `AsyncLocalStorage`.
 *
 * ### Las dos reglas, y por qué
 *
 * 1. **`reqId` en cada línea, sin pasarlo a mano.** Lo pone `src/proxy.ts` al
 *    principio del request y este módulo lo lee del `AsyncLocalStorage`. Si
 *    hubiera que pasarlo como parámetro, la primera función de dominio que se
 *    olvidara dejaría un hueco justo en el camino que más importa seguir.
 * 2. **Nunca sale un dato de una compradora ni un secreto.** No alcanza con
 *    tener cuidado: los campos se **redactan por nombre** antes de serializar
 *    (`phone`, `token`, `secret`, `password`, …). Un log en Hostinger lo lee
 *    cualquiera con acceso al hPanel, y el teléfono de una compradora en un
 *    log es una filtración aunque nadie la mire.
 *
 * Lo que **no** hace: no manda nada a ningún lado. El reporte remoto de
 * errores es `src/instrumentation.ts`, y está apagado salvo que la tienda
 * configure `ERROR_REPORT_URL`.
 */

export type LogLevel = "info" | "warn" | "error";

/** Campos que se guardan por request y viajan solos en cada línea. */
export type RequestContext = { reqId: string };

const almacen = new AsyncLocalStorage<RequestContext>();

/**
 * Corre `fn` con este contexto de request. La llama `src/proxy.ts`.
 *
 * En el edge runtime `AsyncLocalStorage` puede no existir; por eso quien llama
 * no depende de que esto haga algo — sin contexto, el log sale sin `reqId` en
 * vez de romperse.
 */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return almacen.run(context, fn);
}

/** El id del request en curso, o `undefined` fuera de uno (un cron, un script). */
export function currentRequestId(): string | undefined {
  return almacen.getStore()?.reqId;
}

/**
 * Los nombres de campo que **nunca** se imprimen.
 *
 * Por nombre y no por valor, y con `includes` en vez de igualdad: `phone`,
 * `customerPhone`, `to_phone` y `telefono` son todos el mismo dato. Una lista
 * de nombres exactos se queda vieja en el primer refactor que renombre una
 * variable.
 */
const CAMPOS_PROHIBIDOS = [
  "phone",
  "telefono",
  "teléfono",
  "token",
  "secret",
  "secreto",
  "password",
  "contrasena",
  "contraseña",
  "hash",
  "authorization",
  "cookie",
  "accesstoken",
  "apikey",
  "body",
  "email",
  "customername",
  "address",
  "direccion",
  "docnumber",
  "params",
  "rawpayload",
] as const;

export const REDACTED = "[redacted]";

function esProhibido(nombre: string): boolean {
  const normalizado = nombre.toLowerCase();
  return CAMPOS_PROHIBIDOS.some((prohibido) => normalizado.includes(prohibido));
}

/**
 * Redacta en profundidad. Los objetos anidados también: un `{ order: { phone } }`
 * filtra igual que un `{ phone }`.
 *
 * La profundidad se corta a 4 y los arrays a 20 elementos: un log no es un
 * volcado de la base, y un objeto cíclico no puede colgar el proceso que lo
 * está intentando registrar.
 */
function redactar(valor: unknown, profundidad = 0): unknown {
  if (profundidad > 4) return "[…]";
  if (valor === null || typeof valor !== "object") return valor;

  if (Array.isArray(valor)) {
    return valor.slice(0, 20).map((item) => redactar(item, profundidad + 1));
  }

  if (valor instanceof Error) {
    const { name, message } = safeError(valor);
    return { name, message };
  }
  if (valor instanceof Date) return valor.toISOString();

  const salida: Record<string, unknown> = {};
  for (const [clave, item] of Object.entries(
    valor as Record<string, unknown>
  )) {
    salida[clave] = esProhibido(clave)
      ? REDACTED
      : redactar(item, profundidad + 1);
  }
  return salida;
}

export type LogFields = Record<string, unknown>;

/** La línea, ya armada. Separada del `console` para poder testearla. */
export function formatLine(
  level: LogLevel,
  msg: string,
  fields: LogFields = {}
): string {
  const reqId = currentRequestId();
  const linea = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(reqId ? { reqId } : {}),
    ...(redactar(fields) as LogFields),
  };

  try {
    return JSON.stringify(linea);
  } catch {
    // Un campo que no se puede serializar (una referencia cíclica que se
    // escapó de `redactar`) no puede hacer perder el evento entero.
    return JSON.stringify({
      ts: linea.ts,
      level,
      msg,
      reqId,
      fields: "[no serializable]",
    });
  }
}

function emitir(level: LogLevel, msg: string, fields?: LogFields): void {
  const linea = formatLine(level, msg, fields);
  // `console.error` para warn y error: en Hostinger stderr y stdout se leen
  // por separado, y lo que hay que mirar primero es lo que salió mal.
  if (level === "error" || level === "warn") console.error(linea);
  else console.info(linea);
}

export const log = {
  info: (msg: string, fields?: LogFields): void => emitir("info", msg, fields),
  warn: (msg: string, fields?: LogFields): void => emitir("warn", msg, fields),
  error: (msg: string, fields?: LogFields): void =>
    emitir("error", msg, fields),
};

/**
 * El mensaje de un error, para meterlo como campo.
 *
 * Sin el stack: una línea de log con un stack de cuarenta líneas deja de ser
 * una línea, y el stack completo del error ya va por `onRequestError`.
 */
export function mensajeDe(error: unknown): string {
  return safeError(error).message;
}
