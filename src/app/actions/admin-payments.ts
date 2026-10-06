"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { refundPayment, retryOrderRevival } from "@/domain/payment-recovery";
import {
  actorLabel,
  adminActionError,
  requireOwnerSession,
  requireStaffSession,
  type AdminActionResult,
} from "@/lib/admin-guard";
import { t } from "@/i18n";

/**
 * Las dos acciones sobre "Pagos sin pedido vivo" (ARCH.md §4.1).
 *
 * Valen las mismas dos reglas que en `admin-orders.ts`: cada acción re-chequea
 * el rol —una server action es un endpoint HTTP con su propio id, alcanzable
 * con un `fetch` que nunca pasó por `/admin`— y ningún `UPDATE orders SET
 * status` vive acá: el estado lo mueve `transitionOrder`, adentro del dominio.
 *
 * Lo que llega del formulario es un id y nada más. El estado se relee del lado
 * del servidor con el candado tomado (ver `payment-recovery.ts`): la pantalla
 * desde la que se hizo click puede tener minutos de viejo.
 */

const PaymentSchema = z.object({ paymentId: z.number().int().positive() });

/** Refresca las tres vistas que muestran esta plata. */
function revalidatePayment(orderId: number): void {
  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");
  revalidatePath(`/admin/pedidos/${orderId}`);
}

export async function retryPaymentRevival(
  input: unknown
): Promise<AdminActionResult<{ orderNumber: string; changed: boolean }>> {
  try {
    const actor = await requireStaffSession();

    const parsed = PaymentSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: t("adminError.noEntendi.pago") };
    }

    const result = await retryOrderRevival({
      paymentId: parsed.data.paymentId,
      actor: actorLabel(actor),
      actorUserId: actor.userId,
    });

    revalidatePayment(result.orderId);
    return {
      ok: true,
      orderNumber: result.orderNumber,
      changed: result.changed,
    };
  } catch (error) {
    return adminActionError("retryPaymentRevival", error);
  }
}

const RefundSchema = PaymentSchema.extend({
  operationKey: z.uuid(),
  reason: z.string().trim().max(500),
  /**
   * Cuánto devolver, en guaraníes enteros (O7). **Ausente = todo lo que
   * queda**, que es el comportamiento de siempre.
   *
   * Lo que llega acá es una intención, no una decisión: el dominio relee el
   * pago con la fila bloqueada y verifica contra `amount_pyg` y
   * `refunded_pyg` reales. El navegador no decide plata.
   */
  amountPyg: z.number().int().positive().optional(),
  allowSettled: z.boolean().optional(),
});

/**
 * Registrar una devolución. **Sólo el dueño** (ARCH.md §1).
 *
 * Es la única acción del panel que reconoce plata que sale, y ningún otro
 * control la revisa después: quien la aprieta decide solo. Hasta este PR la
 * podía hacer cualquier `staff`.
 *
 * Desde O7 acepta un monto: sin él devuelve todo lo que queda (el
 * comportamiento de siempre), con él registra una devolución **parcial** que
 * deja su fila en `refunds`, suma en `payments.refunded_pyg` y **no mueve el
 * estado del pedido**. `pnpm reconcile` verifica que las tres cosas cuadren.
 */
export async function markPaymentRefunded(input: unknown): Promise<
  AdminActionResult<{
    orderNumber: string;
    changed: boolean;
    refundedPyg?: number;
    fullyRefunded?: boolean;
  }>
> {
  try {
    const actor = await requireOwnerSession();

    const parsed = RefundSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: t("adminError.noEntendi.devolucion") };
    }

    const result = await refundPayment({
      operationKey: parsed.data.operationKey,
      paymentId: parsed.data.paymentId,
      reason: parsed.data.reason,
      amountPyg: parsed.data.amountPyg,
      allowSettled: parsed.data.allowSettled,
      actor: actorLabel(actor),
      actorUserId: actor.userId,
    });

    revalidatePayment(result.orderId);
    return {
      ok: true,
      orderNumber: result.orderNumber,
      changed: result.changed,
      refundedPyg: result.refundedPyg,
      fullyRefunded: result.fullyRefunded,
    };
  } catch (error) {
    return adminActionError("markPaymentRefunded", error);
  }
}
