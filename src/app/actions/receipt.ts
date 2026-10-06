"use server";

import { safeError } from "@/lib/safe-error";

import { requireOrderAccess } from "@/domain/order-access";
import { transitionOrder } from "@/domain/orders";
import {
  ReceiptError,
  assertCanUpload,
  recordReceipt,
  validateReceipt,
} from "@/domain/receipts";
import { carpetaComprobantes, cloudinary } from "@/lib/cloudinary";
import { t } from "@/i18n";
import { cargarIntegraciones } from "@/lib/integraciones-store";

/**
 * Subida del comprobante de transferencia (PLAN.md 3.5).
 *
 * El archivo va a una carpeta **privada** de Cloudinary (`type: authenticated`):
 * un comprobante bancario tiene el nombre y la cuenta del comprador, y una URL
 * pública adivinable sería una filtración. El admin lo mira con URL firmada.
 */

export type UploadReceiptResult = { ok: true } | { ok: false; error: string };

export async function uploadReceipt(
  formData: FormData
): Promise<UploadReceiptResult> {
  // Cloudinary puede estar configurado desde /admin/integraciones.
  await cargarIntegraciones();
  const orderNumber = String(formData.get("orderNumber") ?? "");
  const token = String(formData.get("token") ?? "");
  const file = formData.get("file");

  // Guard primero: sin token válido no se sube nada a nombre de otro pedido.
  const order = await requireOrderAccess(orderNumber, token);
  if (!order) {
    return { ok: false, error: t("error.comprobante.pedidoNoEncontrado") };
  }

  if (!(file instanceof File)) {
    return { ok: false, error: t("error.comprobante.elegiArchivo") };
  }

  try {
    if (order.paymentMethod !== "transferencia") {
      throw new ReceiptError("error.comprobante.noEsTransferencia");
    }
    if (
      !["pendiente_pago", "rechazado", "esperando_verificacion"].includes(
        order.status
      )
    ) {
      throw new ReceiptError("error.comprobante.noEsperaComprobante");
    }

    await assertCanUpload(order.id);

    const content = Buffer.from(await file.arrayBuffer());
    const { mime } = validateReceipt({
      declaredMime: file.type,
      bytes: content.byteLength,
      content,
    });

    const uploaded = await cloudinary.uploader.upload(
      `data:${mime};base64,${content.toString("base64")}`,
      {
        folder: carpetaComprobantes(),
        // `authenticated` = sin URL pública: sólo se ve con firma y TTL.
        type: "authenticated",
        resource_type: mime === "application/pdf" ? "image" : "image",
        public_id: `${order.orderNumber}-${Date.now()}`,
        overwrite: false,
      }
    );

    await recordReceipt({
      orderId: order.id,
      cloudinaryId: uploaded.public_id,
      mime,
      bytes: content.byteLength,
    });

    // El estado sólo se mueve por acá. Si ya estaba esperando verificación
    // (segundo comprobante), transitionOrder lo trata como no-op.
    await transitionOrder(
      order.id,
      "esperando_verificacion",
      "buyer",
      "comprobante subido"
    );

    return { ok: true };
  } catch (error) {
    if (error instanceof ReceiptError) {
      return { ok: false, error: error.message };
    }
    console.error("uploadReceipt falló", safeError(error).message);
    return { ok: false, error: t("error.comprobante.generico") };
  }
}
