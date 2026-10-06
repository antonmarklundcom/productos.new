"use server";

import { headers } from "next/headers";
import { z } from "zod";

import {
  freeShippingForZone,
  type FreeShippingProgress,
} from "@/domain/free-shipping";
import type { CouponRejection } from "@/domain/coupons";
import { computeOrderTotals } from "@/domain/order-totals";
import type {
  ShippingMethodOption,
  ShippingMethodRejection,
  ShippingQuote,
} from "@/domain/shipping";
import type { CartIssue } from "@/lib/cart-issues";
import { currentCustomer } from "@/lib/customer-session";
import { readyPaymentMethods } from "@/domain/payment-readiness";
import { cargarIntegraciones } from "@/lib/integraciones-store";
import {
  QUOTE_LIMIT,
  QUOTE_WINDOW_MS,
  clientIp,
  rateLimit,
} from "@/lib/rate-limit";

/**
 * Cotización de envío **antes** de crear el pedido.
 *
 * Hasta acá el envío se conocía recién con el pedido creado, y el checkout lo
 * decía con todas las letras ("se confirma en la próxima pantalla"). Un monto
 * que aparece después de confirmar es la clase de sorpresa que hace abandonar
 * el carrito, y es un precio que el comercio ya conoce: sale de
 * `shipping_zones`, que es una tabla, no una negociación.
 *
 * Tres cosas que esta acción NO es:
 *
 * 1. **No crea nada.** No hay pedido, no hay reserva, no se toca `on_hand`.
 *    Es sólo lectura, y por eso se puede llamar cada vez que la compradora
 *    corrige la ciudad.
 * 2. **No es una segunda fuente de verdad.** La cuenta la hace
 *    `computeOrderTotals`, la misma función que corre `createOrder` adentro de
 *    su transacción. Acá no hay aritmética de dinero: sólo se transporta.
 * 3. **No vuelve.** El total cotizado no viaja de vuelta al confirmar y nadie
 *    lo compara con nada. Si entre la cotización y el pedido cambia un precio,
 *    manda el pedido — que es exactamente la regla 1 de ARCH.md §1.
 *
 * Tiene rate limit igual, aunque no escriba: cada llamada son tres consultas y
 * la ruta es pública y anónima.
 */

const QuoteInputSchema = z.object({
  items: z.array(
    z.object({
      variantId: z.number().int().positive(),
      qty: z.number().int().min(1).max(99),
    })
  ),
  /** Vacía = todavía no la eligió; se cotiza sólo el subtotal. */
  city: z.string().trim().max(120).optional(),
  /**
   * El código de descuento tipeado, para poder mostrar el total con descuento
   * **antes** de confirmar. Es el código, no el monto: acá tampoco hay
   * aritmética de dinero (ver el punto 2 de arriba).
   */
  couponCode: z.string().trim().max(40).optional(),
  /**
   * El método de envío que tiene marcado, si ya marcó alguno. Es el id, no el
   * precio: el precio lo resuelve el servidor contra `shipping_methods`.
   */
  shippingMethodId: z.number().int().positive().optional(),
});

export type ShippingQuoteView = {
  zoneName: string;
  shippingPyg: number;
  isFree: boolean;
  /** Ver `ShippingQuote.match`: la pantalla dice algo distinto en cada caso. */
  match: ShippingQuote["match"];
};

/** Un método de envío tal como lo dibuja el checkout. */
export type ShippingMethodView = {
  id: number | null;
  /** Estable entre redibujados: es lo que usan los specs de e2e para ubicar el radio. */
  slug: string;
  name: string;
  description: string | null;
  shippingPyg: number;
  isFree: boolean;
  allowedPaymentMethods: ShippingMethodOption["allowedPaymentMethods"];
};

export type CartQuote = {
  subtotalPyg: number;
  /** `null` mientras no haya ciudad: no se muestra un total que no se puede afirmar. */
  totalPyg: number | null;
  shipping: ShippingQuoteView | null;
  freeShipping: FreeShippingProgress;
  issues: CartIssue[];
  /** Lo que descuenta el cupón aplicado. 0 si no hay ninguno. */
  discountPyg: number;
  /** El código que quedó aplicado, ya normalizado. */
  couponCode: string | null;
  /** Por qué no se aplicó el que tipeó. La pantalla lo traduce a una frase. */
  couponRejection: CouponRejection | null;
  /** El mínimo del cupón, para poder decir cuánto le falta. */
  couponMinOrderPyg: number | null;
  /**
   * Los métodos de envío válidos para esta ciudad, con el precio ya resuelto
   * (FASE 3). En una tienda sin métodos configurados viene uno solo, con
   * `id: null`: es el implícito, y el checkout no dibuja nada nuevo.
   */
  methods: ShippingMethodView[];
  /** El que quedó elegido —el pedido, o el primero válido—, para marcarlo. */
  shippingMethodId: number | null;
  /** Por qué el que mandó no sirve. La pantalla lo traduce a una frase. */
  shippingMethodRejection: ShippingMethodRejection | null;
};

const EMPTY_QUOTE: CartQuote = {
  subtotalPyg: 0,
  totalPyg: null,
  shipping: null,
  freeShipping: { kind: "sin_umbral" },
  issues: [],
  discountPyg: 0,
  couponCode: null,
  couponRejection: null,
  couponMinOrderPyg: null,
  methods: [],
  shippingMethodId: null,
  shippingMethodRejection: null,
};

export async function quoteCartShipping(input: unknown): Promise<CartQuote> {
  await cargarIntegraciones();
  const ip = clientIp(await headers());
  if (
    !rateLimit(`quote:${ip}`, { limit: QUOTE_LIMIT, windowMs: QUOTE_WINDOW_MS })
      .ok
  ) {
    // Sin número en vez de un número viejo: la pantalla vuelve a decir que el
    // envío se confirma al crear el pedido, que es lo que decía antes.
    return EMPTY_QUOTE;
  }

  const parsed = QuoteInputSchema.safeParse(input);
  if (!parsed.success) return EMPTY_QUOTE;

  const city = parsed.data.city?.trim() ?? "";
  if (parsed.data.items.length === 0 || city === "") {
    // Sin ciudad no hay zona, y sin zona no hay envío que cotizar. El carrito
    // usa `revalidateCart` para su parte (subtotal + envío gratis).
    return EMPTY_QUOTE;
  }

  // La identidad de quien compra sale de la cookie, nunca del input: si el
  // `customerId` viajara acá, cualquiera cotizaría un cupón `solo_clientes`
  // mandando un id ajeno.
  const customer = await currentCustomer();

  const totals = await computeOrderTotals(parsed.data.items, city, {
    shippingMethodId: parsed.data.shippingMethodId ?? null,
    couponCode: parsed.data.couponCode || null,
    customerId: customer?.customerId ?? null,
    customerPhone: customer?.phone ?? null,
  });

  const ready = await readyPaymentMethods();
  return {
    subtotalPyg: totals.subtotalPyg,
    totalPyg: totals.totalPyg,
    shipping: {
      zoneName: totals.shipping.zoneName,
      shippingPyg: totals.shippingPyg,
      // Del **método**, no de la zona: con retiro en local o una tarifa plana
      // de ₲0 el envío es gratis aunque la zona cobre, y la línea del total
      // tiene que decir lo mismo que el número que está al lado.
      isFree: totals.shippingMethod?.isFree ?? totals.shipping.isFree,
      match: totals.shipping.match,
    },
    freeShipping: freeShippingForZone(totals.shipping, totals.subtotalPyg),
    issues: totals.cart.issues,
    discountPyg: totals.discountPyg,
    couponCode: totals.coupon?.coupon.code ?? null,
    couponRejection: totals.couponRejection,
    couponMinOrderPyg: totals.couponMinOrderPyg,
    methods: totals.shippingMethods.map((method) => ({
      id: method.id,
      slug: method.slug,
      name: method.name,
      description: method.description,
      shippingPyg: method.shippingPyg,
      isFree: method.isFree,
      allowedPaymentMethods: method.allowedPaymentMethods.filter((payment) =>
        ready.includes(payment)
      ),
    })),
    shippingMethodId: totals.shippingMethod?.id ?? null,
    shippingMethodRejection: totals.shippingMethodRejection,
  };
}
