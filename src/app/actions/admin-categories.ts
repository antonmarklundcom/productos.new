"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  AdminCategoryError,
  createCategory,
  moveCategory,
  setCategoryActive,
  setCategoryImage,
  updateCategory,
} from "@/domain/admin-categories";
import { validateProductImage } from "@/domain/product-images";
import {
  adminActionError,
  requireOwnerSession,
  type AdminActionResult,
} from "@/lib/admin-guard";
import { cloudinary, carpetaCategorias } from "@/lib/cloudinary";
import { log, mensajeDe } from "@/lib/log";
import { t } from "@/i18n";

/**
 * ABM de categorías (PLAN.md FASE 2, PR J). **Todas owner-only.**
 *
 * Que sea el dueño y no el encargado no es desconfianza: apagar una categoría
 * saca de la vidriera todos sus productos de una vez (ver `PUBLISHED()` en
 * `src/db/queries.ts`), y cambiarle el slug rompe todas las URLs de esa
 * sección que anden dando vueltas por WhatsApp. Son decisiones que se toman
 * una vez por año y cuyo error se paga en ventas que no llegan.
 *
 * Las validaciones de verdad —slug único, renumerado de posiciones— viven en
 * `src/domain/admin-categories.ts`, adentro de la transacción. Acá arriba
 * serían una carrera.
 *
 * Se revalida `/` y `/categoria/[slug]` además de la pantalla del panel: lo
 * que cambia acá es lo que ve la compradora, y una vidriera cacheada con la
 * categoría vieja es el bug que después se reporta como "no me tomó el cambio".
 */

function revalidarVidriera(): void {
  revalidatePath("/admin/categorias");
  revalidatePath("/", "layout");
}

const CreateSchema = z.object({
  name: z.string().trim().min(1, t("adminForm.nombreCategoria")).max(120),
  slug: z.string().trim().max(120).optional(),
  /**
   * Presentación de la categoría (O7). Los `.max()` son el largo exacto de las
   * columnas; `null` borra el campo y **ausente no lo toca**, que es lo que
   * necesita el formulario de hoy (S10 dibuja los campos).
   */
  description: z.string().trim().max(5000).nullish(),
  imageCloudinaryId: z.string().trim().max(255).nullish(),
  imageAlt: z.string().trim().max(200).nullish(),
});

export async function crearCategoria(input: unknown): Promise<AdminActionResult<{ id: number }>> {
  try {
    await requireOwnerSession();

    const parsed = CreateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.revisaDatos") };
    }

    const created = await createCategory({
      name: parsed.data.name,
      slug: parsed.data.slug || null,
      description: parsed.data.description,
      imageCloudinaryId: parsed.data.imageCloudinaryId,
      imageAlt: parsed.data.imageAlt,
    });

    revalidarVidriera();
    return { ok: true, id: created.id };
  } catch (error) {
    if (error instanceof AdminCategoryError) return { ok: false, error: error.message };
    return adminActionError("crearCategoria", error);
  }
}

const UpdateSchema = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().trim().min(1, t("adminForm.nombreCategoria")).max(120),
  slug: z.string().trim().max(120).optional(),
  /**
   * Presentación de la categoría (O7). Los `.max()` son el largo exacto de las
   * columnas; `null` borra el campo y **ausente no lo toca**, que es lo que
   * necesita el formulario de hoy (S10 dibuja los campos).
   */
  description: z.string().trim().max(5000).nullish(),
  imageCloudinaryId: z.string().trim().max(255).nullish(),
  imageAlt: z.string().trim().max(200).nullish(),
});

export async function editarCategoria(input: unknown): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const parsed = UpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.revisaDatos") };
    }

    await updateCategory({
      categoryId: parsed.data.categoryId,
      name: parsed.data.name,
      slug: parsed.data.slug || null,
      description: parsed.data.description,
      imageCloudinaryId: parsed.data.imageCloudinaryId,
      imageAlt: parsed.data.imageAlt,
    });

    revalidarVidriera();
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminCategoryError) return { ok: false, error: error.message };
    return adminActionError("editarCategoria", error);
  }
}

/**
 * La foto de una categoría, subida de verdad.
 *
 * Clonada de `uploadProductImage`, con las diferencias de siempre: el folder
 * es `categorias/` (público, igual que `productos/` y nunca `comprobantes/`) y
 * el destino es la columna de la categoría, no una fila de `product_images`.
 * Owner-only como el resto de este archivo: la foto de una categoría es la
 * portada de una sección entera de la vidriera.
 *
 * El tipo se valida por **los bytes** (`validateProductImage` sniffea la firma
 * y rechaza SVG, que es un documento ejecutable disfrazado de imagen), no por
 * el `Content-Type` ni por la extensión: los dos los elige quien sube.
 *
 * La foto anterior se borra del CDN **después** de que la fila apunte a la
 * nueva, y un fallo ahí no falla la acción: el peor caso es un archivo de más
 * en Cloudinary, y el peor caso de hacerlo al revés es una categoría apuntando
 * a una foto que ya no existe.
 */
export async function uploadCategoryImage(formData: FormData): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const categoryId = Number(formData.get("categoryId"));
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return { ok: false, error: t("adminError.categoria.noExiste") };
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: t("adminError.elegiFoto") };
    }

    const content = Buffer.from(await file.arrayBuffer());
    const { mime } = validateProductImage({ bytes: content.byteLength, content });

    const uploaded = await cloudinary.uploader.upload(
      `data:${mime};base64,${content.toString("base64")}`,
      { folder: carpetaCategorias(), resource_type: "image", overwrite: false },
    );

    const altRaw = String(formData.get("alt") ?? "").trim();
    const { previousCloudinaryId } = await setCategoryImage({
      categoryId,
      imageCloudinaryId: uploaded.public_id,
      // Ausente = no se toca el alt que ya había.
      imageAlt: formData.has("alt") ? (altRaw === "" ? null : altRaw.slice(0, 200)) : undefined,
    });

    if (previousCloudinaryId) {
      try {
        await cloudinary.uploader.destroy(previousCloudinaryId, { resource_type: "image" });
      } catch (error) {
        log.warn("uploadCategoryImage.destroy", { error: mensajeDe(error) });
      }
    }

    revalidarVidriera();
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminCategoryError) return { ok: false, error: error.message };
    return adminActionError("uploadCategoryImage", error);
  }
}

const ActiveSchema = z.object({
  categoryId: z.number().int().positive(),
  isActive: z.boolean(),
});

export async function cambiarEstadoCategoria(input: unknown): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const parsed = ActiveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.noEntendi.categoria") };

    await setCategoryActive({
      categoryId: parsed.data.categoryId,
      isActive: parsed.data.isActive,
    });

    revalidarVidriera();
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminCategoryError) return { ok: false, error: error.message };
    return adminActionError("cambiarEstadoCategoria", error);
  }
}

const MoveSchema = z.object({
  categoryId: z.number().int().positive(),
  direction: z.enum(["up", "down"]),
});

export async function moverCategoria(input: unknown): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const parsed = MoveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.noEntendi.mover") };

    await moveCategory({
      categoryId: parsed.data.categoryId,
      direction: parsed.data.direction,
    });

    revalidarVidriera();
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminCategoryError) return { ok: false, error: error.message };
    return adminActionError("moverCategoria", error);
  }
}
