import { enqueueOrderNotice, kickOrderNotices } from "./notification-outbox";
import { readyPaymentMethods } from "./payment-readiness";
import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import {
  orderItems,
  orders,
  type DocType,
  type PaymentMethod,
} from "@/db/schema";
import { t } from "@/i18n";
import { formatGs } from "@/lib/money";
import { normalizePhonePY, validateDoc } from "@/lib/py";

import type { CartInput } from "./cart";
import { lockCouponForUse, type CouponRejection } from "./coupons";
import { recordOrderEvent } from "./order-events";
import { nextOrderNumber } from "./order-number";
import { computeOrderTotals } from "./order-totals";
import type { ShippingMethodRejection } from "./shipping";
import { RESERVATION_TTL_MINUTES, reserveStock } from "./stock";
import type { MessageKey, Params } from "@/i18n";
import type { CartIssue } from "@/lib/cart-issues";

import { DomainError } from "./errors";
import { operationTransaction } from "./operation-keys";

/**
 * Creación del pedido (PLAN.md 3.3).
 *
 * Todo pasa en UNA transacción: re-precia el carrito contra la DB, cotiza el
 * envío, saca el número de pedido del contador, inserta el pedido con sus
 * ítems y toma las reservas de stock. Si algo falla, no queda ni el número
 * consumido con un pedido a medias.
 *
 * El navegador no decide nada acá: manda variantes, cantidades y datos de
 * envío; los montos salen de la base.
 */

export type CreateOrderInput = {
  operationKey?: string;
  items: readonly CartInput[];
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  docType: DocType;
  docNumber?: string | null;
  isConsumidorFinal: boolean;
  shipCity: string;
  shipBarrio?: string | null;
  shipAddress: string;
  shipReference?: string | null;
  shipMapsUrl?: string | null;
  paymentMethod: PaymentMethod;
  /**
   * El **id** del método de envío que eligió (FASE 3). Nunca su precio: acá
   * se re-cotiza contra la DB adentro de la transacción, igual que el resto
   * de la plata.
   *
   * `undefined`/`null` = el navegador no eligió ninguno (un checkout viejo, o
   * una tienda sin métodos configurados): se toma el primero válido, que en
   * esa tienda es el implícito de siempre.
   */
  shippingMethodId?: number | null;
  /**
   * La cuenta que hizo el pedido, si había sesión de cliente abierta (PR E).
   *
   * Lo pone la server action leyendo **la cookie**, nunca el navegador: si
   * viniera del formulario, cualquiera podría atar su compra a la cuenta de
   * otra persona mandando un id distinto. `undefined` es el caso normal —el
   * checkout de invitado, que no se toca— y queda NULL en la columna.
   */
  customerId?: number | null;
  /**
   * El **código** de descuento que tipeó, si tipeó alguno (PR G). Nunca un
   * monto: el descuento lo calcula `computeOrderTotals` contra la DB, adentro
   * de esta misma transacción.
   */
  couponCode?: string | null;
  /**
   * Novedades y promociones. `null`/`undefined` = no se preguntó; se guarda
   * tal cual, sin convertirlo a `false` (ver `orders.marketing_opt_in`).
   */
  marketingOptIn?: boolean | null;
  /** Pedido para regalar, con un mensaje opcional para la tarjeta. */
  isGift?: boolean;
  giftNote?: string | null;
  /**
   * El total que el navegador venía **mostrando**, para poder avisar si
   * cambió. Se compara, nunca se cobra: lo que se cobra sale de
   * `computeOrderTotals` unas líneas más abajo, contra la DB y adentro de
   * esta transacción (ARCH.md §1 regla 1). Mismo criterio que
   * `expectedPrices` en `priceCart`.
   *
   * `undefined` = no se le mostró ningún total (no llegó a poner la ciudad),
   * así que no hay nada que comparar y el pedido sigue de largo.
   */
  expectedTotalPyg?: number | null;
};

export type CreatedOrder = {
  orderId: number;
  orderNumber: string;
  accessToken: string;
  subtotalPyg: number;
  shippingPyg: number;
  totalPyg: number;
  iva10Pyg: number;
  iva5Pyg: number;
  reservedUntil: Date;
};

export class CheckoutError extends DomainError {
  readonly issues: CartIssue[];

  constructor(
    code: MessageKey,
    options: { params?: Params; issues?: CartIssue[] } = {}
  ) {
    super(code, options.params);
    this.issues = options.issues ?? [];
    this.name = "CheckoutError";
  }
}

/**
 * El total cambió entre lo que ella vio y lo que corresponde cobrar.
 *
 * Existe porque el umbral de envío gratis hace que el total **no** sea
 * monótono en el precio: un producto de ₲500.000 con envío gratis a partir de
 * ₲500.000 que el comercio baja a ₲490.000 cae abajo del umbral y pasa a
 * pagar flete — más barato el producto, más caro el total. Sin este aviso,
 * cobrarle de más después de una rebaja es indistinguible de un error.
 *
 * No se cobra ninguno de los dos números por venir del navegador: `after` es
 * el que acaba de calcular el servidor, y es el que se cobra si ella
 * confirma de nuevo.
 */
export class TotalChangedError extends CheckoutError {
  constructor(
    readonly before: number,
    readonly after: number
  ) {
    super("error.checkout.totalCambio", {
      params: { antes: formatGs(before), despues: formatGs(after) },
    });
    this.name = "TotalChangedError";
  }
}

/**
 * El código de descuento dejó de servir entre que lo aplicó y que confirmó.
 *
 * Se venció, se agotó, el dueño lo desactivó, o el carrito cambió y ya no
 * llega al mínimo. En todos los casos el pedido **no** se crea: cobrarle el
 * precio sin descuento a alguien que confirmó contando con él es la clase de
 * sorpresa que hace que no vuelva.
 */
export class CouponRejectedError extends CheckoutError {
  constructor(readonly reason: CouponRejection) {
    super("error.checkout.cuponCaido");
    this.name = "CouponRejectedError";
  }
}

/**
 * El método de envío que eligió no se puede usar.
 *
 * Se venció el rato que estuvo en pantalla y el dueño lo desactivó, cambió las
 * zonas a las que aplica, o directamente la ciudad que terminó poniendo no
 * tiene ninguna forma de entrega configurada. En todos los casos el pedido
 * **no** se crea: cobrarle un flete que no corresponde al modo en que se le va
 * a entregar es peor que hacerle elegir de nuevo.
 *
 * No es un 500: es una decisión del dominio con su mensaje, igual que el cupón
 * caído.
 */
export class ShippingMethodRejectedError extends CheckoutError {
  constructor(readonly reason: ShippingMethodRejection) {
    super(
      reason === "sin_metodos"
        ? "error.checkout.sinMetodoEnvio"
        : "error.checkout.metodoEnvioCaido"
    );
    this.name = "ShippingMethodRejectedError";
  }
}

/**
 * El método de envío elegido no acepta ese medio de pago.
 *
 * Es la regla que da sentido a toda la tabla: "contra entrega" sólo existe
 * donde alguien del comercio va a estar en la puerta para cobrar. El checkout
 * ya filtra los medios de pago al elegir el método, así que llegar acá
 * significa un POST armado a mano o una configuración que cambió mientras
 * completaba el formulario — y las dos terminan igual, sin pedido.
 */
export class PaymentMethodNotAllowedError extends CheckoutError {
  constructor(
    readonly methodName: string,
    readonly paymentMethod: PaymentMethod
  ) {
    super("error.checkout.pagoNoPermitido", {
      params: { envio: methodName, pago: t(`metodo.${paymentMethod}`) },
    });
    this.name = "PaymentMethodNotAllowedError";
  }
}

/** 32 bytes de aleatoriedad: el link de WhatsApp es la única llave del pedido. */
function mintAccessToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createOrder(
  input: CreateOrderInput
): Promise<CreatedOrder> {
  const phone = normalizePhonePY(input.customerPhone);
  if (!phone) {
    throw new CheckoutError("error.checkout.telefono");
  }

  const doc = validateDoc(input.docType, input.docNumber);
  if (!doc.ok) {
    throw new CheckoutError(
      input.docType === "RUC" ? "error.checkout.ruc" : "error.checkout.ci",
      { params: { motivo: doc.reason ?? "" } }
    );
  }

  if (input.items.length === 0) {
    throw new CheckoutError("error.checkout.carritoVacio");
  }

  const { result: stored } = await operationTransaction(
    { scope: "checkout", key: input.operationKey, payload: input },
    async (tx) => {
      if (!(await readyPaymentMethods(tx)).includes(input.paymentMethod))
        throw new CheckoutError("error.checkout.pagoNoDisponible");
      // 1 y 2. Re-precio y envío, con el executor de **esta** transacción. Es la
      //    misma función que usa la cotización pública (`computeOrderTotals`),
      //    corrida de nuevo acá: lo que la compradora vio en pantalla no viaja
      //    en el input y no se compara con nada, se recalcula.
      const {
        cart,
        shipping,
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
      } = await computeOrderTotals(input.items, input.shipCity, {
        executor: tx,
        shippingMethodId: input.shippingMethodId ?? null,
        couponCode: input.couponCode ?? null,
        customerId: input.customerId ?? null,
        customerPhone: phone,
      });

      // Si mandó un código y no sirve, el pedido **no** se crea en silencio sin
      // el descuento: ella lo confirmó contando con ese precio. Se lo decimos y
      // vuelve a confirmar, igual que con un cambio de total.
      if (couponRejection) {
        throw new CouponRejectedError(couponRejection);
      }

      // 1.b. El método de envío, re-validado acá adentro y no en el formulario
      //      (FASE 3). Lo que llegó del navegador es un **id**; que ese id siga
      //      activo, que aplique a la ciudad que finalmente puso y que acepte el
      //      medio de pago que eligió se decide contra la DB, en esta
      //      transacción. El precio ya salió de la misma consulta: el número que
      //      la compradora tenía en pantalla no participa del cobro.
      if (shippingMethodRejection !== null || shippingMethod === null) {
        throw new ShippingMethodRejectedError(
          shippingMethodRejection ?? "sin_metodos"
        );
      }
      if (!shippingMethod.allowedPaymentMethods.includes(input.paymentMethod)) {
        throw new PaymentMethodNotAllowedError(
          shippingMethod.name,
          input.paymentMethod
        );
      }

      const blocking = cart.issues.filter(
        (issue) => issue.type !== "precio_cambio"
      );
      if (cart.lines.length === 0 || blocking.length > 0) {
        throw new CheckoutError("error.checkout.noDisponible", {
          issues: cart.issues,
        });
      }

      // 2.b. ¿Le estamos por cobrar algo distinto de lo que vio?
      //
      //      La comparación va **adentro** de la transacción y antes de
      //      escribir nada: si no coincide, esto tira y no queda ni el pedido,
      //      ni el número consumido, ni la reserva. El número del navegador no
      //      participa del cobro en ningún caso — sólo dice qué había en
      //      pantalla.
      if (
        input.expectedTotalPyg !== undefined &&
        input.expectedTotalPyg !== null &&
        input.expectedTotalPyg !== totalPyg
      ) {
        throw new TotalChangedError(input.expectedTotalPyg, totalPyg);
      }

      // 2.c. Gastar el uso del cupón, **con la fila bloqueada**.
      //
      //       La validación de arriba pasó antes del candado, así que no decide
      //       nada por sí sola: dos checkouts simultáneos con un cupón de un
      //       solo uso la pasan los dos. Lo que decide es esta re-lectura con
      //       `FOR UPDATE`, exactamente igual que el stock. El que pierde la
      //       carrera recibe `CouponRaceError` y no se crea su pedido.
      if (coupon) {
        await lockCouponForUse(tx, coupon.coupon.id, {
          customerId: input.customerId ?? null,
          customerPhone: phone,
        });
      }

      // 3. Número de pedido del contador, adentro de la misma transacción.
      const orderNumber = await nextOrderNumber(tx);
      const accessToken = mintAccessToken();
      const reservedUntil = new Date(
        Date.now() + RESERVATION_TTL_MINUTES[input.paymentMethod] * 60_000
      );

      await tx.insert(orders).values({
        orderNumber,
        accessToken,
        status: "pendiente_pago",
        customerName: input.customerName.trim(),
        customerPhone: phone,
        customerEmail: input.customerEmail?.trim() || null,
        docType: input.docType,
        docNumber: doc.normalized ?? null,
        isConsumidorFinal: input.isConsumidorFinal,
        shipCity: input.shipCity.trim(),
        shipBarrio: input.shipBarrio?.trim() || null,
        shipAddress: input.shipAddress.trim(),
        shipReference: input.shipReference?.trim() || null,
        shipMapsUrl: input.shipMapsUrl?.trim() || null,
        shippingZoneId: shipping.zoneId,
        shippingMethodId: shippingMethod.id,
        // Snapshot del nombre, como el código del cupón: si mañana el dueño
        // borra "Moto Asunción", este pedido tiene que seguir diciendo cómo se
        // entregó.
        shippingMethodName: shippingMethod.name,
        subtotalPyg,
        shippingPyg,
        totalPyg,
        iva10Pyg,
        iva5Pyg,
        paymentMethod: input.paymentMethod,
        customerId: input.customerId ?? null,
        couponId: coupon?.coupon.id ?? null,
        // Snapshot del código, como los nombres de los ítems: si mañana el dueño
        // borra el cupón, este pedido tiene que seguir explicando su descuento.
        couponCode: coupon?.coupon.code ?? null,
        discountPyg,
        reservedUntil,
        isGift: input.isGift ?? false,
        // La nota se descarta si el pedido no es un regalo: si no, destildar la
        // casilla dejaría el mensaje viejo colgado y alguien lo imprimiría.
        giftNote: input.isGift ? input.giftNote?.trim() || null : null,
        marketingOptIn: input.marketingOptIn ?? null,
        // La fecha acompaña a cualquier respuesta explícita, no sólo al "sí":
        // saber cuándo dijo que no es lo que después evita mandarle igual.
        marketingOptInAt:
          input.marketingOptIn === null || input.marketingOptIn === undefined
            ? null
            : new Date(),
      });

      const inserted = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);
      const orderId = inserted[0]?.id;
      if (!orderId) throw new CheckoutError("error.checkout.noPude");

      // 4. Ítems con snapshot: lo que el comprador aceptó, congelado.
      await tx.insert(orderItems).values(
        cart.lines.map((line) => ({
          orderId,
          variantId: line.variantId,
          nameSnapshot: `${line.name} — ${line.variantLabel}`,
          skuSnapshot: line.sku,
          unitPricePyg: line.unitPricePyg,
          qty: line.qty,
          ivaRate: line.ivaRate,
          lineTotalPyg: line.lineTotalPyg,
        }))
      );

      // 5. Reservas: FOR UPDATE sobre cada variante y re-chequeo adentro de la
      //    misma transacción. Acá se corta el sobreventa.
      await reserveStock(
        orderId,
        cart.lines.map((line) => ({
          variantId: line.variantId,
          qty: line.qty,
        })),
        { expiresAt: reservedUntil, executor: tx }
      );

      // 6. Primera fila del log. No es una transición (no hubo cambio de
      //    estado), así que no pasa por transitionOrder.
      await recordOrderEvent(
        {
          orderId,
          status: "pendiente_pago",
          actor: "buyer",
          reason: `pedido creado (${input.paymentMethod}, ${shippingMethod.name})`,
        },
        { executor: tx }
      );

      await enqueueOrderNotice(tx, orderId, "confirmado", "pendiente_pago");
      await enqueueOrderNotice(tx, orderId, "dueno", "pendiente_pago");
      return {
        orderId,
        orderNumber,
        accessToken,
        subtotalPyg,
        shippingPyg,
        totalPyg,
        iva10Pyg,
        iva5Pyg,
        reservedUntil,
      };
    }
  );
  const created: CreatedOrder = {
    ...stored,
    reservedUntil: new Date(stored.reservedUntil),
  };

  kickOrderNotices(created.orderId);

  return created;
}
