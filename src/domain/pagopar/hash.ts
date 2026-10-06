import { createHash, timingSafeEqual } from "node:crypto";

import { assertGs, MoneyError } from "@/lib/money";

/**
 * Los dos hashes de Pagopar (ARCH.md §4).
 *
 * Son dos funciones separadas a propósito, con entradas distintas:
 *
 *   - petición  → sha1(PRIVATE_KEY + order_number + total_pyg)
 *   - webhook   → sha1(PRIVATE_KEY + hash_pedido)
 *
 * Unificarlas en un `sha1(private + ...args)` genérico es la forma más rápida
 * de terminar firmando el webhook con el total del pedido y pasar la tarde
 * mirando un 401 sin explicación. Cada una tiene su vector de test.
 */

/**
 * El total, tal cual viaja en el hash: **entero, sin separadores, sin coma**.
 *
 * `"150000"`, nunca `"150000.00"`. Todo reflejo de JS con plata empuja a
 * `toFixed(2)`, y ese string produce un digest completamente distinto que
 * Pagopar rechaza (ARCH.md §4). Los guaraníes no tienen céntimos: si acá llega
 * algo que no es un entero, es un bug del camino del dinero y explota.
 */
export function pagoparAmount(totalPyg: number): string {
  assertGs(totalPyg, "total_pyg");
  if (totalPyg < 0) {
    throw new MoneyError(`total_pyg no puede ser negativo, recibí ${totalPyg}`);
  }
  return String(totalPyg);
}

function sha1Hex(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("hex");
}

/**
 * Token de `iniciar-transaccion`: `sha1(PRIVATE_KEY + order_number + total)`.
 *
 * `order_number` es `orders.order_number` (`"PY-000123"`), el número humano e
 * inmutable — nunca el id interno, que cambia si algún día se migra la base.
 */
export function requestToken(
  privateKey: string,
  orderNumber: string,
  totalPyg: number
): string {
  requirePrivateKey(privateKey);
  if (orderNumber.trim() === "") {
    throw new PagoparHashError("order_number vacío");
  }
  return sha1Hex(`${privateKey}${orderNumber}${pagoparAmount(totalPyg)}`);
}

/**
 * Token del webhook: `sha1(PRIVATE_KEY + hash_pedido)`.
 *
 * Otra entrada, otro digest. Pagopar lo manda en el querystring de la
 * notificación y es lo único que separa a un pago real de cualquiera en
 * internet posteando JSON a la ruta.
 */
export function webhookGuardToken(privateKey: string, hashPedido: string): string {
  requirePrivateKey(privateKey);
  if (hashPedido.trim() === "") {
    throw new PagoparHashError("hash_pedido vacío");
  }
  return sha1Hex(`${privateKey}${hashPedido}`);
}

/**
 * Comparación en tiempo constante.
 *
 * `===` sobre strings corta en el primer byte distinto, y esa diferencia de
 * tiempo alcanza para reconstruir un digest válido byte por byte contra un
 * endpoint público. El largo se compara aparte porque `timingSafeEqual` tira
 * si los buffers difieren, y ese throw ya filtraría el largo.
 */
export function tokensMatch(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class PagoparHashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PagoparHashError";
  }
}

function requirePrivateKey(privateKey: string): void {
  if (privateKey === "") {
    throw new PagoparHashError("falta la clave privada de Pagopar");
  }
}
