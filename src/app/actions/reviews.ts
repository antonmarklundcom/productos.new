"use server";

import { safeError } from "@/lib/safe-error";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { requireOrderAccess } from "@/domain/order-access";
import {
  REVIEW_BODY_MAX,
  REVIEW_TITLE_MAX,
  ReviewError,
  submitReview,
} from "@/domain/reviews";
import { t } from "@/i18n";
import {
  REVIEW_IP_LIMIT,
  REVIEW_IP_WINDOW_MS,
  clientIp,
  rateLimit,
} from "@/lib/rate-limit";

/**
 * "Calificá tu compra", desde la página del pedido.
 *
 * **Pública**, como el comprobante: no hay sesión, hay un link con token. Así
 * que el acceso se re-chequea acá exactamente igual que en la página
 * (`requireOrderAccess` con número + token) — una server action es un
 * endpoint con su propio id y se la puede llamar sin haber abierto nunca la
 * página. Que el pedido esté entregado y que el producto esté en el pedido lo
 * decide el dominio releyendo la base (`src/domain/reviews.ts`).
 */

const ReviewSchema = z.object({
  orderNumber: z.string().trim().min(1).max(16),
  token: z.string().trim().min(1).max(64),
  productId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  title: z
    .string()
    .max(REVIEW_TITLE_MAX * 2)
    .optional(),
  // El largo real (10..2000, trimmed) lo valida el dominio con su mensaje;
  // esto sólo corta un cuerpo absurdo antes de tocar la base.
  body: z.string().max(REVIEW_BODY_MAX * 2),
});

export type SubmitReviewResult = { ok: true } | { ok: false; error: string };

export async function enviarResena(
  input: unknown
): Promise<SubmitReviewResult> {
  try {
    const parsed = ReviewSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: t("error.resena.generico") };

    const ip = clientIp(await headers());
    if (
      !rateLimit(`resena:ip:${ip}`, {
        limit: REVIEW_IP_LIMIT,
        windowMs: REVIEW_IP_WINDOW_MS,
      }).ok
    ) {
      return { ok: false, error: t("error.resena.demasiados") };
    }

    // Guard: mismo 404 lógico que la página. Token inválido y pedido
    // inexistente dan la misma respuesta.
    const order = await requireOrderAccess(
      parsed.data.orderNumber,
      parsed.data.token
    );
    if (!order) return { ok: false, error: t("error.resena.pedidoNoExiste") };

    await submitReview({
      orderId: order.id,
      productId: parsed.data.productId,
      rating: parsed.data.rating,
      title: parsed.data.title ?? null,
      body: parsed.data.body,
    });

    revalidatePath("/admin/resenas");
    return { ok: true };
  } catch (error) {
    if (error instanceof ReviewError)
      return { ok: false, error: error.message };
    console.error("enviarResena falló", safeError(error).message);
    return { ok: false, error: t("error.resena.generico") };
  }
}
