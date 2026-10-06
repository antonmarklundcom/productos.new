"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { validateProductImage } from "@/domain/product-images";
import {
  StoreSettingsError,
  readStoreSettings,
  resetStoreSettingsSection,
  saveStoreSettingsSection,
} from "@/domain/store-settings";
import { STORE_SETTINGS_SECTIONS, type StoreSettingsSection } from "@/domain/store-settings-schema";
import { t } from "@/i18n";
import {
  adminActionError,
  requireOwnerSession,
  type AdminActionResult,
} from "@/lib/admin-guard";
import { carpetaMarca, carpetaPortadas, cloudinary } from "@/lib/cloudinary";

/**
 * Ajustes de la tienda (`/admin/ajustes`). **Todas owner-only**, como el
 * banco: acá se cambia el WhatsApp al que escriben las compradoras, la cara
 * de la home y lo que la tienda promete en sus políticas.
 *
 * La validación de cada campo vive en el dominio (`SECTION_INPUT` de
 * `store-settings-schema.ts`); acá sólo se valida la forma del pedido —qué
 * sección— y se traduce el error para el formulario. `saveStoreSettingsSection`
 * ya revalida toda la vidriera.
 */

const SeccionSchema = z.enum(STORE_SETTINGS_SECTIONS as [StoreSettingsSection, ...StoreSettingsSection[]]);

const GuardarSchema = z.object({
  seccion: SeccionSchema,
  valores: z.record(z.string(), z.unknown()),
});

export async function guardarAjustes(input: unknown): Promise<AdminActionResult> {
  try {
    const actor = await requireOwnerSession();

    const parsed = GuardarSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.revisaDatos") };

    await saveStoreSettingsSection(parsed.data.seccion, parsed.data.valores, {
      userId: actor.userId,
    });

    revalidatePath("/admin/ajustes");
    return { ok: true };
  } catch (error) {
    if (error instanceof StoreSettingsError) return { ok: false, error: error.message };
    return adminActionError("guardarAjustes", error);
  }
}

export async function restaurarAjustes(input: unknown): Promise<AdminActionResult> {
  try {
    const actor = await requireOwnerSession();

    const parsed = z.object({ seccion: SeccionSchema }).safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.revisaDatos") };

    await resetStoreSettingsSection(parsed.data.seccion, { userId: actor.userId });

    revalidatePath("/admin/ajustes");
    return { ok: true };
  } catch (error) {
    if (error instanceof StoreSettingsError) return { ok: false, error: error.message };
    return adminActionError("restaurarAjustes", error);
  }
}

/**
 * La foto de portada, subida a Cloudinary con el mismo camino que el QR del
 * banco (`subirQrBancario`): el tipo se valida por **los bytes**, la carpeta
 * es pública (`portadas/`) y lo que se guarda es el `public_id`.
 */
export async function subirImagenPortada(formData: FormData): Promise<AdminActionResult> {
  try {
    const actor = await requireOwnerSession();

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: t("adminError.ajustes.elegiImagen") };
    }

    const content = Buffer.from(await file.arrayBuffer());
    const { mime } = validateProductImage({ bytes: content.byteLength, content });

    const uploaded = await cloudinary.uploader.upload(
      `data:${mime};base64,${content.toString("base64")}`,
      { folder: carpetaPortadas(), resource_type: "image", overwrite: false },
    );

    await guardarImagenPortada(uploaded.public_id, actor.userId);

    revalidatePath("/admin/ajustes");
    return { ok: true };
  } catch (error) {
    if (error instanceof StoreSettingsError) return { ok: false, error: error.message };
    return adminActionError("subirImagenPortada", error);
  }
}

/**
 * Saca la foto del panel y vuelve a la de `tienda.ts` (o a ninguna). **No
 * borra el archivo de Cloudinary**, mismo criterio que las fotos de producto.
 */
export async function quitarImagenPortada(): Promise<AdminActionResult> {
  try {
    const actor = await requireOwnerSession();

    await guardarImagenPortada(null, actor.userId);

    revalidatePath("/admin/ajustes");
    return { ok: true };
  } catch (error) {
    if (error instanceof StoreSettingsError) return { ok: false, error: error.message };
    return adminActionError("quitarImagenPortada", error);
  }
}

/** Cambia sólo la foto: el resto de "Marca y portada" queda como estaba. */
async function guardarImagenPortada(publicId: string | null, userId: number): Promise<void> {
  const { settings } = await readStoreSettings();
  await saveStoreSettingsSection("marca", { ...settings.marca, heroImagenId: publicId }, { userId });
}

const TipoImagenMarca = z.enum(["logo", "favicon"]);
type TipoImagenMarca = z.infer<typeof TipoImagenMarca>;

/**
 * El logo o el favicon de la tienda (`/admin/ajustes` → Identidad). Mismo
 * camino que la portada: el tipo se valida por **los bytes**, la carpeta es
 * pública (`marca/`) y lo que se guarda es el `public_id`.
 */
export async function subirImagenMarca(formData: FormData): Promise<AdminActionResult> {
  try {
    const actor = await requireOwnerSession();

    const tipo = TipoImagenMarca.safeParse(formData.get("tipo"));
    if (!tipo.success) return { ok: false, error: t("adminError.revisaDatos") };

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: t("adminError.ajustes.elegiImagen") };
    }

    const content = Buffer.from(await file.arrayBuffer());
    const { mime } = validateProductImage({ bytes: content.byteLength, content });

    const uploaded = await cloudinary.uploader.upload(
      `data:${mime};base64,${content.toString("base64")}`,
      { folder: carpetaMarca(), resource_type: "image", overwrite: false },
    );

    await guardarImagenMarca(tipo.data, uploaded.public_id, actor.userId);

    revalidatePath("/admin/ajustes");
    return { ok: true };
  } catch (error) {
    if (error instanceof StoreSettingsError) return { ok: false, error: error.message };
    return adminActionError("subirImagenMarca", error);
  }
}

/** Saca el logo o el favicon (no borra el archivo de Cloudinary). */
export async function quitarImagenMarca(input: unknown): Promise<AdminActionResult> {
  try {
    const actor = await requireOwnerSession();

    const tipo = TipoImagenMarca.safeParse((input as { tipo?: unknown } | null)?.tipo);
    if (!tipo.success) return { ok: false, error: t("adminError.revisaDatos") };

    await guardarImagenMarca(tipo.data, null, actor.userId);

    revalidatePath("/admin/ajustes");
    return { ok: true };
  } catch (error) {
    if (error instanceof StoreSettingsError) return { ok: false, error: error.message };
    return adminActionError("quitarImagenMarca", error);
  }
}

/** Cambia sólo esa imagen: el nombre y el color quedan como estaban. */
async function guardarImagenMarca(
  tipo: TipoImagenMarca,
  publicId: string | null,
  userId: number,
): Promise<void> {
  const { settings } = await readStoreSettings();
  const campo = tipo === "logo" ? "logoId" : "faviconId";
  await saveStoreSettingsSection("identidad", { ...settings.identidad, [campo]: publicId }, { userId });
}
