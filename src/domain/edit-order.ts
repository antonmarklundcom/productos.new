import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDb } from '@/db';
import { coupons, orderItems, orders, payments, stockReservations } from '@/db/schema';
import type { OrderStatus, PaymentMethod } from '@/db/schema';
import type { MessageKey, Params } from '@/i18n';
import { formatGs } from '@/lib/money';

import { computeDiscount } from './coupons';
import { DomainError } from './errors';
import type { Executor } from './executor';
import { recordOrderEvent } from './order-events';
import { sumOrderMoney } from './order-totals';
import { quoteShippingMethods, selectShippingMethod } from './shipping';

/**
 * Editar un pedido que todavía no se pagó (plan-crecimiento §5.3).
 *
 * El caso real, el que hoy se resuelve cancelando y rehaciendo: la compradora
 * escribe por WhatsApp "mandame dos en vez de tres" o "me equivoqué de
 * dirección". Cancelar y rehacer le cambia el número de pedido, le pierde el
 * link que ya tiene y le recotiza todo con los precios de hoy. Editar conserva
 * las tres cosas.
 *
 * Las reglas que lo hacen seguro, y por qué cada una:
 *
 * 1. **Sólo `pendiente_pago`, sólo transferencia y contra entrega, y sólo si
 *    no hay un pago `paid`.** Con tarjeta el monto ya está comprometido en
 *    Pagopar y la verificación de monto del webhook es la red que atrapa un
 *    cobro que no coincide: editar el total de un pedido de tarjeta sería
 *    romper esa red a mano. Ahí se cancela y se rehace, y la pantalla lo dice.
 * 2. **Las cantidades sólo bajan o se quitan.** Subir obligaría a re-validar
 *    stock contra reservas ajenas y a decidir qué pasa si no alcanza; eso es
 *    un pedido nuevo, que además es lo que la compradora espera. Y el pedido
 *    no puede quedar sin líneas: un pedido vacío no es un pedido, es una
 *    cancelación con otro nombre.
 * 3. **`unit_price_pyg` no cambia nunca.** Es el precio que ella vio y aceptó.
 *    Si el catálogo subió entre medio, ese aumento no puede entrar por la
 *    puerta de atrás de una corrección de cantidad.
 * 4. **El envío lo re-cotiza el dominio**, nunca el navegador, y con el
 *    subtotal nuevo: bajar de ₲600.000 a ₲200.000 puede haber cruzado el
 *    umbral de envío gratis para el otro lado, y el pedido tiene que decir la
 *    verdad.
 * 5. **Todo en una transacción con la fila del pedido bloqueada.** Entre leer
 *    y escribir, el cron puede vencerlo o puede entrar el aviso de un pago.
 * 6. **No es una transición**: el estado no se mueve, así que esto no pasa por
 *    `transitionOrder` y `orders.status` sigue teniendo un solo escritor. Lo
 *    que queda es una fila en `order_events` con `from = to` y el prefijo de
 *    abajo, el mismo mecanismo del reembolso parcial.
 */

/**
 * El prefijo del motivo que deja una edición en `order_events`.
 *
 * Constante y no literal suelto porque `reconcile` lo lee: el control de
 * aristas imposibles tiene que reconocer estas filas —que a propósito tienen
 * `from = to`— como legítimas en vez de reportarlas
 * (`src/domain/reconciliation.ts`, el `CASE` de `arista_imposible`).
 */
export const EDIT_ORDER_REASON_PREFIX = 'edición: ';

/** El pedido no se puede editar, o lo que se pidió editar no es válido. */
export class EditOrderError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = 'EditOrderError';
  }
}

/** Por qué un pedido no se puede editar. La pantalla lo traduce a una línea. */
export type NotEditableReason = 'estado' | 'tarjeta' | 'pagado';

export type Editability =
  | { editable: true }
  | { editable: false; reason: NotEditableReason };

/**
 * ¿Se puede editar este pedido? La **misma** regla que aplica
 * `editPendingOrder` adentro de su transacción.
 *
 * Vive separada para que la ficha del pedido pueda dibujar el botón (o el
 * motivo por el que no está) sin duplicar la condición. No la reemplaza: lo
 * que decide es la relectura con la fila bloqueada, porque entre que se pintó
 * la pantalla y el click pudo entrar el pago.
 */
export function canEditPendingOrder(order: {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  hasPaidPayment?: boolean;
}): Editability {
  if (order.status !== 'pendiente_pago') return { editable: false, reason: 'estado' };
  if (order.paymentMethod === 'tarjeta') return { editable: false, reason: 'tarjeta' };
  if (order.hasPaidPayment) return { editable: false, reason: 'pagado' };
  return { editable: true };
}

export type EditOrderItemInput = {
  orderItemId: number;
  /** La cantidad nueva. Entero, `0` quita la línea, nunca mayor que la actual. */
  qty: number;
};

export type EditOrderShippingInput = {
  city: string;
  address: string;
  reference?: string | null;
  /** El **id** del método, nunca su precio. Ausente = se conserva el actual. */
  shippingMethodId?: number | null;
};

export type EditOrderInput = {
  orderId: number;
  /** Email de quien lo hizo desde el panel, igual que en toda auditoría. */
  actor: string;
  actorUserId?: number | null;
  /** Sólo las líneas que cambian. Las que no vienen quedan como están. */
  items?: readonly EditOrderItemInput[];
  shipping?: EditOrderShippingInput;
  /** Por qué se editó. Lo escribe quien edita y queda en la historia. */
  reason: string;
};

export type EditedOrderLine = {
  orderItemId: number;
  nameSnapshot: string;
  unitPricePyg: number;
  qty: number;
  lineTotalPyg: number;
};

export type EditOrderResult = {
  orderId: number;
  orderNumber: string;
  /** Para armar el link tokenizado del mensaje a la compradora. */
  accessToken: string;
  /** El total de antes, para que la pantalla diga "₲X → ₲Y". */
  previousTotalPyg: number;
  subtotalPyg: number;
  discountPyg: number;
  shippingPyg: number;
  totalPyg: number;
  iva10Pyg: number;
  iva5Pyg: number;
  shipCity: string;
  shipAddress: string;
  shipReference: string | null;
  shippingMethodId: number | null;
  shippingMethodName: string | null;
  /** Hasta cuándo puede pagar. **No cambia al editar.** */
  reservedUntil: Date | null;
  /** `true` si el cupón dejó de aplicar con las cantidades nuevas. */
  couponRemoved: boolean;
  /** El código que tenía, cuando se lo quitó. Para poder decirlo en pantalla. */
  removedCouponCode: string | null;
  lines: EditedOrderLine[];
};

/** Mínimo del motivo: el mismo criterio que el rechazo de un comprobante. */
export const EDIT_MIN_REASON = 5;

export async function editPendingOrder(input: EditOrderInput): Promise<EditOrderResult> {
  const reason = input.reason.trim();
  if (reason.length < EDIT_MIN_REASON) {
    throw new EditOrderError('error.edicion.motivo');
  }

  return getDb().transaction(async (tx) => {
    // 1. La fila del pedido, bloqueada. Todo lo que sigue decide sobre esto y
    //    no sobre lo que decía la pantalla.
    const filas = await tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1).for('update');
    const order = filas[0];
    if (!order) throw new EditOrderError('error.edicion.noExiste');

    const pagado = await tienePagoAcreditado(tx, order.id);
    const editable = canEditPendingOrder({
      status: order.status,
      paymentMethod: order.paymentMethod,
      hasPaidPayment: pagado,
    });
    if (!editable.editable) {
      throw new EditOrderError(
        editable.reason === 'tarjeta'
          ? 'error.edicion.tarjeta'
          : editable.reason === 'pagado'
            ? 'error.edicion.yaPagado'
            : 'error.edicion.estado',
      );
    }

    // 2. Las líneas. Las que no vienen en el input quedan como están.
    const actuales = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    if (actuales.length === 0) throw new EditOrderError('error.edicion.sinLineas');

    const pedidas = new Map<number, number>();
    for (const cambio of input.items ?? []) {
      if (!Number.isInteger(cambio.qty) || cambio.qty < 0) {
        throw new EditOrderError('error.edicion.cantidad');
      }
      const linea = actuales.find((item) => item.id === cambio.orderItemId);
      if (!linea) throw new EditOrderError('error.edicion.lineaAjena');
      // Subir es un pedido nuevo, no una edición (regla 2).
      if (cambio.qty > linea.qty) throw new EditOrderError('error.edicion.cantidadSube');
      pedidas.set(cambio.orderItemId, cambio.qty);
    }

    const nuevas = actuales.map((linea) => {
      const qty = pedidas.get(linea.id) ?? linea.qty;
      return {
        linea,
        qty,
        // El precio unitario es el que ella vio. Acá sólo se multiplica.
        lineTotalPyg: linea.unitPricePyg * qty,
      };
    });

    const quedan = nuevas.filter((fila) => fila.qty > 0);
    if (quedan.length === 0) throw new EditOrderError('error.edicion.quedaVacio');

    // 3. Escribir las líneas: las que bajan se actualizan, las que quedan en
    //    cero se borran.
    const borradas = nuevas.filter((fila) => fila.qty === 0).map((fila) => fila.linea.id);
    if (borradas.length > 0) {
      await tx.delete(orderItems).where(inArray(orderItems.id, borradas));
    }
    for (const fila of quedan) {
      if (fila.qty === fila.linea.qty) continue;
      await tx
        .update(orderItems)
        .set({ qty: fila.qty, lineTotalPyg: fila.lineTotalPyg })
        .where(eq(orderItems.id, fila.linea.id));
    }

    // 4. Las reservas siguen a las líneas: lo que ya no se va a vender tiene
    //    que volver a estar disponible para quien sí lo quiera comprar. Nunca
    //    suben (regla 2), así que no hay stock que volver a pedir.
    await ajustarReservas(tx, order.id, quedan);

    // 5. El envío, re-cotizado por el dominio con el subtotal nuevo.
    const shipCity = (input.shipping?.city ?? order.shipCity).trim();
    const subtotalPyg = quedan.reduce((sum, fila) => sum + fila.lineTotalPyg, 0);

    const { zone, methods } = await quoteShippingMethods(shipCity, subtotalPyg, tx);
    // Sin método pedido se conserva el del pedido. Si ese método ya no existe
    // o no aplica a la ciudad nueva, el error lo dice en vez de cobrar otro.
    const pedidoMetodoId =
      input.shipping && 'shippingMethodId' in input.shipping
        ? (input.shipping.shippingMethodId ?? null)
        : order.shippingMethodId;
    const seleccion = selectShippingMethod(methods, pedidoMetodoId);
    if (!seleccion.ok) throw new EditOrderError('error.edicion.envio');
    const metodo = seleccion.method;
    // La regla de ARCH.md: cómo se entrega decide con qué se paga. Cambiar de
    // ciudad no puede dejar un contra entrega donde nadie va a estar en la
    // puerta para cobrar.
    if (!metodo.allowedPaymentMethods.includes(order.paymentMethod)) {
      throw new EditOrderError('error.edicion.envioPago');
    }

    // 6. El cupón, contra el subtotal nuevo.
    const cupon = await revalidarCupon(tx, order, subtotalPyg);

    // 7. La cuenta, con la misma función que usa el checkout.
    const money = sumOrderMoney(
      quedan.map((fila) => ({ lineTotalPyg: fila.lineTotalPyg, ivaRate: fila.linea.ivaRate })),
      { discountPyg: cupon.discountPyg, shippingPyg: metodo.shippingPyg },
    );

    const previousTotalPyg = order.totalPyg;

    await tx
      .update(orders)
      .set({
        shipCity,
        shipAddress: (input.shipping?.address ?? order.shipAddress).trim(),
        shipReference:
          input.shipping && 'reference' in input.shipping
            ? input.shipping.reference?.trim() || null
            : order.shipReference,
        shippingZoneId: zone.zoneId,
        shippingMethodId: metodo.id,
        shippingMethodName: metodo.name,
        subtotalPyg: money.subtotalPyg,
        discountPyg: money.discountPyg,
        shippingPyg: money.shippingPyg,
        totalPyg: money.totalPyg,
        iva10Pyg: money.iva10Pyg,
        iva5Pyg: money.iva5Pyg,
        couponId: cupon.removed ? null : order.couponId,
        couponCode: cupon.removed ? null : order.couponCode,
        // `reserved_until` **no** se toca: editar no le regala tiempo a nadie,
        // y extenderlo le bloquearía el stock al resto por más rato.
      })
      .where(eq(orders.id, order.id));

    // 8. La auditoría. `from = to`: el estado no se movió, y el prefijo es lo
    //    que `reconcile` mira para no reportarlo como arista imposible.
    await recordOrderEvent(
      {
        orderId: order.id,
        status: order.status,
        fromStatus: order.status,
        actor: input.actor,
        actorUserId: input.actorUserId ?? null,
        reason: `${EDIT_ORDER_REASON_PREFIX}${resumen({
          borradas: borradas.length,
          bajadas: quedan.filter((fila) => fila.qty !== fila.linea.qty).length,
          ciudadNueva: shipCity !== order.shipCity ? shipCity : null,
          cuponQuitado: cupon.removed ? (order.couponCode ?? 'sin código') : null,
          antes: previousTotalPyg,
          despues: money.totalPyg,
          motivo: reason,
        })}`.slice(0, 500),
      },
      { executor: tx },
    );

    // 9. Lo que se devuelve es lo que quedó escrito, releído.
    const [releido] = await tx.select().from(orders).where(eq(orders.id, order.id)).limit(1);
    const lineas = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      accessToken: order.accessToken,
      previousTotalPyg,
      subtotalPyg: money.subtotalPyg,
      discountPyg: money.discountPyg,
      shippingPyg: money.shippingPyg,
      totalPyg: money.totalPyg,
      iva10Pyg: money.iva10Pyg,
      iva5Pyg: money.iva5Pyg,
      shipCity: releido?.shipCity ?? shipCity,
      shipAddress: releido?.shipAddress ?? order.shipAddress,
      shipReference: releido?.shipReference ?? null,
      shippingMethodId: metodo.id,
      shippingMethodName: metodo.name,
      reservedUntil: releido?.reservedUntil ?? order.reservedUntil,
      couponRemoved: cupon.removed,
      removedCouponCode: cupon.removed ? (order.couponCode ?? null) : null,
      lines: lineas.map((linea) => ({
        orderItemId: linea.id,
        nameSnapshot: linea.nameSnapshot,
        unitPricePyg: linea.unitPricePyg,
        qty: linea.qty,
        lineTotalPyg: linea.lineTotalPyg,
      })),
    };
  });
}

/** ¿Este pedido ya tiene un pago acreditado? */
async function tienePagoAcreditado(tx: Executor, orderId: number): Promise<boolean> {
  const filas = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, 'paid')))
    .limit(1);
  return filas.length > 0;
}

/**
 * Baja (o suelta) las reservas para que acompañen a las líneas nuevas.
 *
 * `reserveStock` inserta **una** fila por variante, así que lo normal es que
 * haya exactamente una por cada una. Si por lo que sea hubiera más de una para
 * la misma variante, la primera se queda con toda la cantidad y las demás se
 * sueltan: el total reservado es lo que importa, y dos filas sumando de más es
 * stock bloqueado que nadie puede comprar.
 */
async function ajustarReservas(
  tx: Executor,
  orderId: number,
  quedan: readonly { qty: number; linea: { variantId: number } }[],
): Promise<void> {
  const necesario = new Map<number, number>();
  for (const fila of quedan) {
    necesario.set(fila.linea.variantId, (necesario.get(fila.linea.variantId) ?? 0) + fila.qty);
  }

  const reservas = await tx
    .select()
    .from(stockReservations)
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.state, 'held')))
    .orderBy(stockReservations.id);

  const yaAsignado = new Set<number>();
  for (const reserva of reservas) {
    const pendiente = yaAsignado.has(reserva.variantId)
      ? 0
      : (necesario.get(reserva.variantId) ?? 0);
    yaAsignado.add(reserva.variantId);

    if (pendiente === 0) {
      await tx
        .update(stockReservations)
        .set({ state: 'released' })
        .where(eq(stockReservations.id, reserva.id));
      continue;
    }
    if (pendiente === reserva.qty) continue;
    await tx
      .update(stockReservations)
      .set({ qty: pendiente })
      .where(eq(stockReservations.id, reserva.id));
  }
}

type CuponEditado = { discountPyg: number; removed: boolean };

/**
 * El cupón del pedido, contra el subtotal nuevo.
 *
 * **No** se re-corre `validateCoupon` entero, y es una decisión: esa función
 * responde "¿se le puede dar este cupón a alguien ahora?", y acá la pregunta
 * es otra, "¿el cupón que este pedido ya tiene sigue aplicando con estas
 * cantidades?". Los controles de vigencia, de usos y de usos por persona
 * contestarían que no por motivos que no tienen nada que ver con la edición
 * —empezando por el uso que este mismo pedido ya consumió— y le subirían el
 * total a una compradora que sólo pidió mandar una remera menos.
 *
 * Lo que sí cambia con la edición es el **mínimo de compra**, y eso se
 * re-chequea. El monto se recalcula siempre: un 10 % sobre un subtotal nuevo
 * es otro número.
 *
 * Al quitar el cupón por mínimo de compra se devuelve el uso con su fila
 * bloqueada, en esta misma transacción: reconcile compara `times_used` con
 * los pedidos que siguen apuntando al cupón.
 */
async function revalidarCupon(
  tx: Executor,
  order: { couponId: number | null; discountPyg: number; subtotalPyg: number },
  subtotalPyg: number,
): Promise<CuponEditado> {
  if (!order.couponId) return { discountPyg: 0, removed: false };

  const filas = await tx.select().from(coupons).where(eq(coupons.id, order.couponId)).limit(1).for('update');
  const cupon = filas[0];
  // El cupón se borró de la tabla desde que se compró: no hay con qué
  // recalcular el descuento, así que se quita y se dice.
  if (!cupon) return { discountPyg: 0, removed: true };

  // Sólo una edición que **baja** el subtotal puede dejarlo bajo el mínimo.
  // El mínimo se puede cambiar después de usado el cupón (el código, el tipo
  // y el valor no): sin esta condición, corregir la dirección de un pedido
  // de ₲300.000 le quitaba el descuento porque el comercio había subido el
  // mínimo a ₲400.000 para los pedidos nuevos.
  const bajaElSubtotal = subtotalPyg < order.subtotalPyg;
  if (bajaElSubtotal && cupon.minOrderPyg !== null && subtotalPyg < cupon.minOrderPyg) {
    await tx
      .update(coupons)
      .set({ timesUsed: sql`GREATEST(CAST(${coupons.timesUsed} AS SIGNED) - 1, 0)` })
      .where(eq(coupons.id, cupon.id));
    return { discountPyg: 0, removed: true };
  }

  return {
    discountPyg: computeDiscount({ type: cupon.type, value: cupon.value }, subtotalPyg),
    removed: false,
  };
}

/** El resumen que queda en la historia del pedido. Sin datos de nadie. */
function resumen(input: {
  borradas: number;
  bajadas: number;
  ciudadNueva: string | null;
  cuponQuitado: string | null;
  antes: number;
  despues: number;
  motivo: string;
}): string {
  const partes: string[] = [];
  if (input.bajadas > 0) partes.push(`${input.bajadas} línea(s) con menos cantidad`);
  if (input.borradas > 0) partes.push(`${input.borradas} línea(s) quitada(s)`);
  if (input.ciudadNueva) partes.push(`ciudad: ${input.ciudadNueva}`);
  if (input.cuponQuitado) partes.push(`cupón ${input.cuponQuitado} quitado`);
  partes.push(`total ${formatGs(input.antes)} → ${formatGs(input.despues)}`);
  return `${partes.join(', ')} · ${input.motivo}`;
}
