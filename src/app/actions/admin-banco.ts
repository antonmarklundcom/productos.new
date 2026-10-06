"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  AdminBankError,
  clearBankQr,
  saveBankDetails,
  setBankQr,
} from "@/domain/admin-bank";
import { validateProductImage } from "@/domain/product-images";
import { t } from "@/i18n";
import {
  adminActionError,
  requireOwnerSession,
  type AdminActionResult,
} from "@/lib/admin-guard";
import { carpetaBanco, cloudinary } from "@/lib/cloudinary";

/**
 * Datos bancarios del comercio (PLAN.md FASE 2, PR T). **Todas owner-only.**
 *
 * Es el dato del que depende el método de pago principal de la tienda: quien
 * puede cambiar el número de cuenta al que transfieren las compradoras puede
 * desviar la facturación entera a otra cuenta, y hacerlo sin dejar un pedido
 * raro ni un log de plata — la tienda seguiría funcionando igual y el dueño se
 * enteraría al mirar su banco. No hay ningún nivel de "encargado" al que eso
 * se delegue: es owner, como los reembolsos y los usuarios.
 *
 * Lo que se revalida es la vidriera: `/pedido/[orderNumber]` es
 * `force-dynamic`, pero el panel de "por cobrar" y el resumen leen los datos
 * para avisar cuando faltan.
 */

const DatosSchema = z.object({
  banco: z.string().trim().min(1, t("adminForm.banco.banco")).max(120),
  titular: z.string().trim().min(1, t("adminForm.banco.titular")).max(160),
  ruc: z.string().trim().min(1, t("adminForm.banco.ruc")).max(20),
  cuenta: z.string().trim().min(1, t("adminForm.banco.cuenta")).max(60),
  tipoCuenta: z.string().trim().min(1, t("adminForm.banco.tipoCuenta")).max(60),
});

export async function guardarDatosBancarios(input: unknown): Promise<AdminActionResult> {
  try {
    const actor = await requireOwnerSession();

    const parsed = DatosSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.revisaDatos") };
    }

    await saveBankDetails({ data: parsed.data, actorUserId: actor.userId });

    revalidatePath("/admin/banco");
    revalidatePath("/admin");
    revalidatePath("/admin/pedidos/por-cobrar");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminBankError) return { ok: false, error: error.message };
    return adminActionError("guardarDatosBancarios", error);
  }
}

/**
 * Subida del QR SPI.
 *
 * Clonada de `uploadProductImage`, con las dos diferencias que importan: el
 * folder es `banco/` —**público**, nunca `comprobantes/`, que es
 * `authenticated` y sólo se sirve firmado— y el destino no es una fila de
 * `product_images` sino la columna del singleton.
 *
 * El tipo de archivo se valida por **los bytes** (`validateProductImage`
 * sniffea la firma del archivo), no por lo que diga el `Content-Type` ni la
 * extensión: los dos los elige quien sube.
 */
export async function subirQrBancario(formData: FormData): Promise<AdminActionResult> {
  try {
    const actor = await requireOwnerSession();

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: t("adminError.banco.elegiQr") };
    }

    const content = Buffer.from(await file.arrayBuffer());
    const { mime } = validateProductImage({ bytes: content.byteLength, content });

    const uploaded = await cloudinary.uploader.upload(
      `data:${mime};base64,${content.toString("base64")}`,
      { folder: carpetaBanco(), resource_type: "image", overwrite: false },
    );

    await setBankQr({ qrCloudinaryId: uploaded.public_id, actorUserId: actor.userId });

    revalidatePath("/admin/banco");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminBankError) return { ok: false, error: error.message };
    return adminActionError("subirQrBancario", error);
  }
}

export async function quitarQrBancario(): Promise<AdminActionResult> {
  try {
    const actor = await requireOwnerSession();

    await clearBankQr({ actorUserId: actor.userId });

    revalidatePath("/admin/banco");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminBankError) return { ok: false, error: error.message };
    return adminActionError("quitarQrBancario", error);
  }
}
