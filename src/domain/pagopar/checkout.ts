import { and, eq } from "drizzle-orm";
import { withLockRetry } from "@/db/retry";

import { getDb } from "@/db";
import { orderItems, orders, payments } from "@/db/schema";

import { iniciarTransaccion, type PagoparRequestOptions } from "./client";

/**
 * Arranque del pago con tarjeta (PLAN.md 5.1, ARCH.md §4).
 *
 * Corre después de `createOrder`, con el pedido ya escrito y el stock ya
 * reservado: acá no se re-precia nada ni se toca el estado, sólo se abre la
 * transacción en Pagopar y se deja la fila de `payments` con
 * `provider_ref = hash_pedido`.
 *
 * Esa fila es la que después le permite al webhook saber de qué pedido habla
 * el aviso, y por eso se escribe **antes** de redirigir al comprador: el aviso
 * de pago puede llegar antes que el navegador vuelva (ARCH.md §4), y si el
 * `hash_pedido` no estuviera guardado, el webhook no tendría a qué pedido
 * aplicarlo.
 */

export class PagoparCheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PagoparCheckoutError";
  }
}

export type StartedPagoparCheckout = {
  orderId: number;
  orderNumber: string;
  totalPyg: number;
  hashPedido: string;
};

export async function startPagoparCheckout(
  orderId: number,
  options: PagoparRequestOptions = {}
): Promise<StartedPagoparCheckout> {
  const db = getDb();

  const order = (
    await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        totalPyg: orders.totalPyg,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        customerEmail: orders.customerEmail,
        docType: orders.docType,
        docNumber: orders.docNumber,
        shipCity: orders.shipCity,
        shipAddress: orders.shipAddress,
        reservedUntil: orders.reservedUntil,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
  )[0];

  if (!order) throw new PagoparCheckoutError(`No existe el pedido ${orderId}`);

  // Un pedido ya pagado (o vencido, o cancelado) no vuelve a la pasarela.
  if (order.status !== "pendiente_pago") {
    throw new PagoparCheckoutError(
      `El pedido ${order.orderNumber} está en "${order.status}" y no admite un pago nuevo`
    );
  }

  const existing = await withLockRetry(() =>
    db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          state: orders.cardCheckoutState,
          status: orders.status,
          method: orders.paymentMethod,
          expires: orders.reservedUntil,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (
        !locked ||
        locked.status !== "pendiente_pago" ||
        locked.method !== "tarjeta" ||
        (locked.expires && locked.expires <= new Date())
      )
        throw new PagoparCheckoutError(
          "El pedido no admite un nuevo pago con tarjeta."
        );
      const [payment] = await tx
        .select({ ref: payments.providerRef })
        .from(payments)
        .where(
          and(
            eq(payments.orderId, orderId),
            eq(payments.provider, "pagopar"),
            eq(payments.status, "pending")
          )
        )
        .limit(1);
      if (payment) return payment.ref;
      if (!locked || locked.state !== "idle")
        throw new PagoparCheckoutError(
          "El inicio del pago está en curso o requiere revisión del comercio."
        );
      await tx
        .update(orders)
        .set({ cardCheckoutState: "starting" })
        .where(eq(orders.id, orderId));
      return null;
    })
  );
  if (existing)
    return {
      orderId,
      orderNumber: order.orderNumber,
      totalPyg: order.totalPyg,
      hashPedido: existing,
    };

  try {
    const items = await db
      .select({
        sku: orderItems.skuSnapshot,
        nombre: orderItems.nameSnapshot,
        qty: orderItems.qty,
        unitPricePyg: orderItems.unitPricePyg,
        lineTotalPyg: orderItems.lineTotalPyg,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));

    if (items.length === 0) {
      throw new PagoparCheckoutError(
        `El pedido ${order.orderNumber} no tiene ítems`
      );
    }

    const { hashPedido, envelope } = await iniciarTransaccion(
      {
        orderNumber: order.orderNumber,
        totalPyg: order.totalPyg,
        descripcion: `Pedido ${order.orderNumber}`,
        comprador: {
          nombre: order.customerName,
          telefono: order.customerPhone,
          email: order.customerEmail,
          documento: order.docNumber,
          tipoDocumento: order.docType === "RUC" ? "RUC" : "CI",
          ciudad: order.shipCity,
          direccion: order.shipAddress,
        },
        items: items.map((item) => ({
          sku: item.sku,
          nombre: item.nombre,
          cantidad: item.qty,
          precioPyg: item.unitPricePyg,
          totalPyg: item.lineTotalPyg,
        })),
        // Sin `reserved_until` no hay reserva que respetar; el default de 45 min
        // del método tarjeta ya lo puso createOrder.
        fechaMaximaPago:
          order.reservedUntil ?? new Date(Date.now() + 45 * 60_000),
      },
      // A timeout/5xx can follow provider acceptance. Never repeat this POST automatically.
      { ...options, attempts: 1 }
    );

    // `UNIQUE (provider, provider_ref)`: si el comprador vuelve atrás y reintenta
    // con el mismo hash, se refresca la fila en vez de duplicarla.
    await db.transaction(async (tx) => {
      await tx
        .insert(payments)
        .values({
          orderId: order.id,
          provider: "pagopar",
          providerRef: hashPedido,
          amountPyg: order.totalPyg,
          status: "pending",
          rawPayload: envelope,
        })
        .onDuplicateKeyUpdate({
          set: { amountPyg: order.totalPyg, rawPayload: envelope },
        });
      await tx
        .update(orders)
        .set({ cardCheckoutState: "ready" })
        .where(eq(orders.id, orderId));
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalPyg: order.totalPyg,
      hashPedido,
    };
  } catch (error) {
    await db
      .update(orders)
      .set({ cardCheckoutState: "unknown" })
      .where(eq(orders.id, orderId));
    throw error;
  }
}
