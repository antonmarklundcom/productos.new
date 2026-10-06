import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { receipts, type OrderStatus } from "@/db/schema";
import { signedReceiptUrl } from "@/lib/cloudinary";

import { ReceiptError } from "./receipts";
import { transitionOrder } from "./orders";

/**
 * Revisión del comprobante por parte del dueño (PLAN.md 4.4 y 4.5).
 *
 * Aprobar un comprobante es el momento en que la tienda decide que entró
 * plata: mueve el pedido a `pagado`, y eso descuenta stock. Por eso el cambio
 * de estado no se escribe acá — se delega en `transitionOrder`, adentro de la
 * misma transacción que marca el comprobante. O queda todo (comprobante
 * revisado + pedido movido + fila en `order_events`) o no queda nada.
 */

export const REJECTION_MIN_REASON = 5;

export type ReceiptDecision = "approved" | "rejected";

/** A qué estado va el pedido según la decisión. */
const TARGET_STATUS: Record<ReceiptDecision, OrderStatus> = {
  approved: "pagado",
  // `rechazado` deja que el comprador suba otro comprobante (ARCH.md §3).
  rejected: "rechazado",
};

export type ReviewResult = {
  orderId: number;
  status: OrderStatus;
  /** `false` si el pedido ya estaba en ese estado (doble click). */
  changed: boolean;
};

export async function reviewReceipt(input: {
  receiptId: number;
  decision: ReceiptDecision;
  /** Motivo. Obligatorio para rechazar: el comprador lo lee. */
  note?: string | null;
  reviewerId: number;
  actor: string;
}): Promise<ReviewResult> {
  const note = input.note?.trim() ?? "";

  if (input.decision === "rejected" && note.length < REJECTION_MIN_REASON) {
    throw new ReceiptError("error.comprobante.sinMotivo");
  }

  return getDb().transaction(async (tx) => {
    // FOR UPDATE: dos pestañas abiertas en el mismo comprobante no pueden
    // aprobarlo y rechazarlo a la vez.
    const locked = await tx
      .select({ id: receipts.id, orderId: receipts.orderId, review: receipts.review })
      .from(receipts)
      .where(eq(receipts.id, input.receiptId))
      .for("update");

    const receipt = locked[0];
    if (!receipt) {
      throw new ReceiptError("error.comprobante.noExiste");
    }
    if (receipt.review !== "pending") {
      throw new ReceiptError(
        receipt.review === "approved"
          ? "error.comprobante.yaAprobado"
          : "error.comprobante.yaRechazado",
      );
    }

    await tx
      .update(receipts)
      .set({
        review: input.decision,
        reviewedBy: input.reviewerId,
        reviewedAt: new Date(),
        note: note === "" ? null : note.slice(0, 500),
      })
      .where(and(eq(receipts.id, receipt.id), eq(receipts.review, "pending")));

    const target = TARGET_STATUS[input.decision];
    const transition = await transitionOrder(
      receipt.orderId,
      target,
      input.actor,
      note === "" ? `comprobante ${input.decision === "approved" ? "aprobado" : "rechazado"}` : note,
      // `reviewerId` ya es el `users.id` de quien decidió: la misma persona que
      // queda en `receipts.reviewed_by` queda ahora en el evento del pedido.
      { executor: tx, actorUserId: input.reviewerId },
    );

    return { orderId: receipt.orderId, status: target, changed: transition.changed };
  });
}

/**
 * URL firmada para mirar el comprobante desde el panel.
 *
 * Los comprobantes viven en una carpeta `authenticated` de Cloudinary: no
 * tienen URL pública. Se firma una por vez, con TTL corto, y se genera recién
 * cuando el dueño pide verla — no se embebe en el HTML del listado, donde
 * quedaría cacheada y compartible.
 */
export async function receiptPreview(
  receiptId: number,
  options: { expiresInSeconds?: number } = {},
): Promise<{ url: string; mime: string; orderId: number }> {
  const rows = await getDb()
    .select({
      id: receipts.id,
      orderId: receipts.orderId,
      cloudinaryId: receipts.cloudinaryId,
      mime: receipts.mime,
    })
    .from(receipts)
    .where(eq(receipts.id, receiptId))
    .limit(1);

  const receipt = rows[0];
  if (!receipt) {
    throw new ReceiptError("error.comprobante.noExiste");
  }

  return {
    url: signedReceiptUrl(receipt.cloudinaryId, {
      expiresInSeconds: options.expiresInSeconds ?? 120,
    }),
    mime: receipt.mime,
    orderId: receipt.orderId,
  };
}
