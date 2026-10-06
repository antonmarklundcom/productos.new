"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { registerReturn, RETURN_REASON_MAX } from "@/domain/returns";
import {
  actorLabel,
  adminActionError,
  requireStaffSession,
  type AdminActionResult,
} from "@/lib/admin-guard";
import { t } from "@/i18n";

/**
 * Registrar una devolución de mercadería (capability `devoluciones`, los
 * mismos roles que `stock`: owner y staff).
 *
 * Lo que llega es una intención —"vuelven 2 de esta línea"—, no una decisión:
 * el dominio relee el pedido bloqueado y cuánto queda por devolver de cada
 * línea. **No toca plata**: el reembolso es otra acción (`markPaymentRefunded`,
 * owner-only).
 */

const ReturnSchema = z.object({
  operationKey: z.uuid(),
  orderId: z.number().int().positive(),
  reason: z.string().max(RETURN_REASON_MAX * 2),
  items: z
    .array(
      z.object({
        orderItemId: z.number().int().positive(),
        qty: z.number().int().nonnegative(),
        restock: z.boolean(),
      })
    )
    .max(200),
});

export async function registrarDevolucion(
  input: unknown
): Promise<AdminActionResult<{ returnId: number }>> {
  try {
    const actor = await requireStaffSession();

    const parsed = ReturnSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: t("adminError.noEntendi.mercaderia") };

    const result = await registerReturn({
      operationKey: parsed.data.operationKey,
      orderId: parsed.data.orderId,
      reason: parsed.data.reason,
      // El formulario manda todas las líneas, con 0 en las que no vuelven.
      items: parsed.data.items.filter((item) => item.qty > 0),
      actor: actorLabel(actor),
      actorUserId: actor.userId,
    });

    revalidatePath(`/admin/pedidos/${parsed.data.orderId}`);
    revalidatePath("/admin/devoluciones");
    revalidatePath("/admin/productos");
    revalidatePath("/", "layout");
    return { ok: true, returnId: result.returnId };
  } catch (error) {
    return adminActionError("registrarDevolucion", error);
  }
}
