import { assertGs, ivaBreakdown, ivaIncluded } from "@/lib/money";

import { priceCart, type CartInput, type PricedCart } from "./cart";
import {
  distributeDiscount,
  validateCoupon,
  type CouponRejection,
  type CouponSnapshot,
} from "./coupons";
import type { Executor } from "./executor";
import {
  SHIPPING_IVA_RATE,
  quoteShippingMethods,
  selectShippingMethod,
  type ShippingMethodOption,
  type ShippingMethodRejection,
  type ShippingQuote,
} from "./shipping";

/**
 * La cuenta del pedido, en un solo lugar.
 *
 * Existe porque hay **dos** momentos en que hace falta: la cotización que ve
 * la compradora antes de confirmar, y `createOrder`, que es el único que
 * cobra. Si cada uno hiciera la suma por su lado, tarde o temprano se
 * separan —alcanza con que uno sume el IVA del flete y el otro no— y la
 * pantalla prometería un total distinto del que termina en la factura.
 *
 * La cotización pública es **sólo para mostrar**: no crea nada, no toca
 * stock, y su resultado no viaja al servidor cuando se confirma. `createOrder`
 * vuelve a llamar a esta misma función adentro de su transacción, con el
 * executor de la transacción, y cobra lo que salga de ahí. Que no puedan
 * discrepar no es una convención que haya que respetar: es que son la misma
 * función corriendo dos veces.
 */

export type AppliedCoupon = {
  coupon: CouponSnapshot;
  discountPyg: number;
};

export type OrderTotals = {
  cart: PricedCart;
  shipping: ShippingQuote;
  /**
   * Los métodos de envío válidos para esta ciudad, ya cotizados (FASE 3). En
   * una tienda sin métodos configurados es uno solo, el implícito.
   */
  shippingMethods: ShippingMethodOption[];
  /** El elegido, del que sale `shippingPyg`. `null` sólo si hubo rechazo. */
  shippingMethod: ShippingMethodOption | null;
  /**
   * Por qué **no** se pudo usar el método pedido. `createOrder` lo convierte
   * en un error del dominio antes de cobrar nada; la cotización pública lo
   * muestra en pantalla.
   */
  shippingMethodRejection: ShippingMethodRejection | null;
  subtotalPyg: number;
  /** Lo que descuenta el cupón. 0 cuando no hay ninguno — el caso normal. */
  discountPyg: number;
  shippingPyg: number;
  totalPyg: number;
  iva10Pyg: number;
  iva5Pyg: number;
  /** El cupón que se aplicó, si alguno lo hizo. */
  coupon: AppliedCoupon | null;
  /** Por qué **no** se aplicó el código que mandaron. El checkout lo traduce. */
  couponRejection: CouponRejection | null;
  /** El mínimo del cupón, cuando lo rechazado fue justamente no alcanzarlo. */
  couponMinOrderPyg: number | null;
};

/** Una línea, vista por la aritmética del pedido: lo que cuesta y a qué tasa. */
export type MoneyLine = {
  lineTotalPyg: number;
  ivaRate: number;
};

/** Los cinco números que se guardan en `orders`, ya cuadrados entre sí. */
export type OrderMoney = {
  subtotalPyg: number;
  discountPyg: number;
  shippingPyg: number;
  totalPyg: number;
  iva10Pyg: number;
  iva5Pyg: number;
};

/**
 * La suma del pedido: subtotal, total e IVA desglosado. **Pura.**
 *
 * Extraída de `computeOrderTotals` (donde estaba inline) porque desde O16 hay
 * un segundo camino que tiene que dar exactamente el mismo resultado: editar
 * un pedido sin pagar. La diferencia entre los dos es de dónde salen las
 * líneas —el checkout las re-precia contra el catálogo, la edición conserva el
 * `unit_price_pyg` que la compradora ya vio— y justamente por eso la
 * aritmética no puede estar duplicada: dos copias se separan el día que una
 * suma el IVA del flete y la otra no.
 *
 * Las reglas que codifica, todas de ARCH.md §2:
 *
 * - `total = subtotal − descuento + envío`, la identidad que `pnpm reconcile`
 *   verifica en cada pedido.
 * - El descuento se **reparte entre las líneas** y el IVA se calcula por línea
 *   con el mismo `ivaIncluded` de siempre. Calcularlo sobre el total
 *   descontado daría un desglose que no corresponde a ninguna línea real.
 * - El flete también viene con IVA incluido (`SHIPPING_IVA_RATE`).
 */
export function sumOrderMoney(
  lines: readonly MoneyLine[],
  amounts: { discountPyg: number; shippingPyg: number },
): OrderMoney {
  const subtotalPyg = assertGs(
    lines.reduce((sum, line) => sum + line.lineTotalPyg, 0),
    "subtotal_pyg",
  );
  const discountPyg = assertGs(amounts.discountPyg, "discount_pyg");
  const shippingPyg = assertGs(amounts.shippingPyg, "shipping_pyg");
  const totalPyg = assertGs(subtotalPyg - discountPyg + shippingPyg, "total_pyg");

  const shares = distributeDiscount(
    lines.map((line) => line.lineTotalPyg),
    discountPyg,
  );
  const descontadas = lines.map((line, index) => ({
    lineTotalPyg: line.lineTotalPyg - (shares[index] ?? 0),
    ivaRate: line.ivaRate,
  }));
  const ivaDeLasLineas = ivaBreakdown(descontadas);

  return {
    subtotalPyg,
    discountPyg,
    shippingPyg,
    totalPyg,
    iva10Pyg: ivaDeLasLineas.iva10Pyg + ivaIncluded(shippingPyg, SHIPPING_IVA_RATE),
    iva5Pyg: ivaDeLasLineas.iva5Pyg,
  };
}

export async function computeOrderTotals(
  items: readonly CartInput[],
  shipCity: string,
  options: {
    executor?: Executor;
    expectedPrices?: Map<number, number>;
    /**
     * El **código** que tipeó la compradora. Nunca un monto: el descuento se
     * calcula acá adentro, contra la DB (README §"Reglas no negociables").
     */
    couponCode?: string | null;
    /** Para `solo_clientes` y para el tope de usos por persona. */
    customerId?: number | null;
    customerPhone?: string | null;
    /**
     * El **id** del método de envío que eligió, nunca su precio (FASE 3). Sin
     * id se toma el primero válido, que en una tienda sin métodos
     * configurados es el implícito de siempre.
     */
    shippingMethodId?: number | null;
  } = {}
): Promise<OrderTotals> {
  // 1. Precio, IVA y stock salen de la DB; el navegador sólo dijo qué y cuánto.
  const cart = await priceCart(items, {
    executor: options.executor,
    expectedPrices: options.expectedPrices,
  });

  const subtotalPyg = assertGs(cart.subtotalPyg, "subtotal_pyg");

  // 2. El cupón, si mandaron uno. Se valida contra el subtotal **ya
  //    re-preciado**: el mínimo de compra tiene que mirar lo que se va a
  //    cobrar, no lo que el navegador creía que costaba el carrito.
  let coupon: AppliedCoupon | null = null;
  let couponRejection: CouponRejection | null = null;
  let couponMinOrderPyg: number | null = null;

  if (options.couponCode) {
    const result = await validateCoupon(
      options.couponCode,
      {
        subtotalPyg,
        customerId: options.customerId ?? null,
        customerPhone: options.customerPhone ?? null,
      },
      options.executor,
    );

    if (result.ok) {
      coupon = { coupon: result.coupon, discountPyg: result.discountPyg };
    } else {
      couponRejection = result.reason;
      couponMinOrderPyg = result.minOrderPyg ?? null;
    }
  }

  const discountPyg = assertGs(coupon?.discountPyg ?? 0, "discount_pyg");

  // 3. Envío por zona. El umbral de envío gratis se mira contra el subtotal
  //    **sin** descontar, y es una decisión, no un descuido: si el descuento
  //    bajara el subtotal por debajo del umbral, un cupón le sacaría el envío
  //    gratis que la compradora ya tenía en pantalla. Un cupón nunca puede
  //    empeorar el total.
  //
  //    Desde la FASE 3 el número final lo decide el **método** elegido: una
  //    moto con tarifa plana cobra lo suyo aunque la zona diga otra cosa, y el
  //    retiro en local cuesta ₲0. Con `shipping_methods` vacía —el estado de
  //    toda tienda ya clonada— la única opción es el método implícito, que
  //    cobra exactamente la zona: la cuenta de siempre, sin cambiar una línea.
  const { zone: shipping, methods: shippingMethods } = await quoteShippingMethods(
    shipCity,
    subtotalPyg,
    options.executor,
  );
  const selection = selectShippingMethod(shippingMethods, options.shippingMethodId ?? null);
  const shippingMethod = selection.ok ? selection.method : null;
  const shippingMethodRejection = selection.ok ? null : selection.reason;

  // Con rechazo no hay precio que afirmar: se deja el de la zona **sólo para
  // dibujar** y `createOrder` tira antes de escribir nada (ver más abajo).
  const shippingPyg = assertGs(
    shippingMethod ? shippingMethod.shippingPyg : shipping.shippingPyg,
    "shipping_pyg",
  );

  // 4. La suma, el reparto del descuento y el IVA por línea: `sumOrderMoney`,
  //    la misma función que usa la edición de un pedido (O16).
  const { totalPyg, iva10Pyg, iva5Pyg } = sumOrderMoney(cart.lines, {
    discountPyg,
    shippingPyg,
  });

  return {
    cart,
    shipping,
    shippingMethods,
    shippingMethod,
    shippingMethodRejection,
    subtotalPyg,
    discountPyg,
    shippingPyg,
    totalPyg,
    iva10Pyg,
    iva5Pyg,
    coupon,
    couponRejection,
    couponMinOrderPyg,
  };
}
