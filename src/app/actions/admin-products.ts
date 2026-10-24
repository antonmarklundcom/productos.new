"use server";

import { safeError } from "@/lib/safe-error";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  catalogRevisionConflict,
  addProductImage,
  adjustStock,
  createProduct,
  deleteProductImage,
  saveVariant,
  updateProduct,
} from "@/domain/admin-products";
import {
  applyCatalogFotos,
  buildCatalogImportPlan,
  ensureCatalogCategories,
  type CatalogFotoFallida,
  type CatalogImportPlan,
} from "@/domain/catalog-import-plan";
import {
  normalizeDropiUrl,
  type CatalogoProducto,
} from "@/domain/catalog-import";
import {
  BULK_MAX_IDS,
  BULK_MIN_REASON,
  PERCENT_MAX,
  PERCENT_MIN,
  bulkAdjustPrices,
  bulkMoveCategory,
  bulkSetActive,
  duplicateProduct,
  previewPriceAdjustment,
} from "@/domain/admin-bulk";
import { sweepBackInStock } from "@/domain/stock-alerts";
import { validateProductImage } from "@/domain/product-images";
import { carpetaProductos, cloudinary } from "@/lib/cloudinary";
import { slugify } from "@/lib/slug";
import {
  spreadsheetToCsvText,
  UnsupportedSpreadsheetError,
} from "@/lib/spreadsheet";
import {
  actorLabel,
  adminActionError,
  requireOwnerSession,
  requireStaffSession,
  type AdminActionResult,
} from "@/lib/admin-guard";
import { t } from "@/i18n";
import { getDb } from "@/db";
import { variants, products, productImages, catalogAudit } from "@/db/schema";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  supplierCostsReady,
  writeSupplierOffer,
} from "@/domain/supplier-costs";

const SupplierCostSchema = z
  .object({
    expectedRevision:z.number().int().positive(),
    productId: z.number().int().positive(),
    variantId: z.number().int().positive(),
    offerId: z.number().int().positive().optional(),
    unitCostPyg: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    source: z.string().trim().min(1).max(200),
    sourceType: z.enum(["dropi", "local", "import", "other"]),
    productUrl: z.string().trim().max(2048),
    supplierUrl: z.string().trim().max(2048),
    supplierStock: z.number().int().nonnegative().max(4294967295).nullable(),
    checkedAt: z.string().datetime().nullable(),
    notes: z.string().trim().max(1000),
    isConfirmed: z.boolean(),
    isActive: z.boolean(),
    isPreferred: z.boolean(),
  })
  .refine(
    (offer) =>
      !offer.isPreferred ||
      (offer.isConfirmed && offer.isActive && offer.unitCostPyg !== null)
  );

function supplierLink(value: string) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error(t("panel.costos.enlaceInvalido"));
  return url.toString();
}

export async function saveVariantSupplierCost(
  input: unknown
): Promise<AdminActionResult> {
  try {
    const actor=await requireStaffSession();
    const parsed = SupplierCostSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: t("panel.costos.invalidos") };
    const db = getDb();
    if (!(await supplierCostsReady(db)))
      return { ok: false, error: t("panel.costos.migracion") };
    const { productId, variantId, offerId, checkedAt, expectedRevision, ...offer } = parsed.data;
    const productUrl = supplierLink(offer.productUrl);
    const supplierUrl = supplierLink(offer.supplierUrl);
    await db.transaction(async (tx) => {
      const [baseline]=await tx.select({revision:products.revision}).from(products).where(eq(products.id,productId)).for("update");
      if(!baseline||baseline.revision!==expectedRevision)throw catalogRevisionConflict();
      await tx.update(products).set({revision:sql`${products.revision}+1`}).where(eq(products.id,productId));
      const [variant] = await tx
        .select({ id: variants.id })
        .from(variants)
        .where(
          and(eq(variants.id, variantId), eq(variants.productId, productId))
        )
        .for("update");
      if (!variant) throw new Error(t("adminError.producto.varianteNoExiste"));
      await writeSupplierOffer(
        variantId,
        offerId,
        {
          ...offer,
          productUrl,
          supplierUrl,
          checkedAt: checkedAt ? new Date(checkedAt) : null,
        },
        tx
      );
      const [version]=await tx.select({revision:products.revision}).from(products).where(eq(products.id,productId));
      await tx.insert(catalogAudit).values({id:randomUUID(),actorId:actor.userId,operation:"save-supplier",recordType:"product",recordId:productId,revision:version!.revision,fields:JSON.stringify(["supplierOffers"])});
    });
    revalidatePath("/admin/productos");
    revalidatePath(`/admin/productos/${productId}`);
    return { ok: true };
  } catch (error) {
    return adminActionError("saveVariantSupplierCost", error);
  }
}

function revalidarVidriera() {
  revalidatePath("/", "layout");
}

// Import directo del script de seed: mismo `upsertCatalogProducts` que usa
// `pnpm importar:productos`, no una reimplementación para el panel.
import {
  upsertCatalogProducts,
  type CatalogProductUpsert,
} from "../../../scripts/seed";

/**
 * Alta y edición del catálogo (PLAN.md 4.6).
 *
 * Igual que en `admin-orders.ts`: **cada** acción vuelve a chequear el rol
 * antes de tocar nada. El middleware no cubre las server actions.
 */

const ProductSchema = z.object({
  featuredPosition:z.number().int().min(0).max(1000000).optional(),
  expectedRevision: z.number().int().positive().max(2147483646).optional(),
  dropiUrl: z
    .string()
    .trim()
    .max(2048)
    .nullable()
    .optional()
    .refine((value) => {
      try {
        normalizeDropiUrl(value);
        return true;
      } catch {
        return false;
      }
    }, "Usá un enlace de producto HTTPS de app.dropi.com.py."),
  saleMode: z.enum(["stock", "enquiry", "showcase"]).optional(),
  showPrice: z.boolean().optional(),
  productId: z.number().int().positive().optional(),
  slug: z
    .string()
    .trim()
    // El techo no es decorativo: `products.slug` es VARCHAR(160) y un slug más
    // largo se truncaba en la base, dejando dos productos distintos apuntando
    // a la misma URL (y el segundo guardado fallando por el índice único con
    // un error que no explica nada).
    .max(160, t("adminForm.slugLargo"))
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "El slug va en minúsculas y con guiones: remera-azul"
    ),
  name: z.string().trim().min(2, t("adminForm.nombreProducto")).max(200),
  description: z.string().trim().max(5000).optional(),
  categoryId: z.number().int().positive(),
  brand: z.string().trim().max(120).optional(),
  // 10 | 5 | 0 y nada más: es la tasa que después se factura.
  ivaRate: z.union([z.literal(10), z.literal(5), z.literal(0)]),
  isActive: z.boolean(),
  published: z.boolean(),
  /**
   * Destacado de la home. Opcional a propósito: un formulario que no dibuja la
   * casilla manda `undefined` y `updateProduct` lo lee como "no tocar", así
   * que guardar el precio de un producto destacado no lo des-destaca de paso.
   * En el alta, `createProduct` lo resuelve como `false`.
   */
  isFeatured: z.boolean().optional(),
});

export async function saveProduct(
  input: unknown
): Promise<AdminActionResult<{ productId: number; revision?: number }>> {
  try {
    const actor=await requireStaffSession();

    const parsed = ProductSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Revisá los datos.",
      };
    }

    const write = {
      featuredPosition:parsed.data.featuredPosition,
      expectedRevision: parsed.data.expectedRevision,
      saleMode: parsed.data.saleMode,
      showPrice: parsed.data.showPrice,
      slug: parsed.data.slug,
      name: parsed.data.name,
      description: parsed.data.description || null,
      categoryId: parsed.data.categoryId,
      brand: parsed.data.brand || null,
      dropiUrl: normalizeDropiUrl(parsed.data.dropiUrl),
      ivaRate: parsed.data.ivaRate,
      isActive: parsed.data.isActive,
      published: parsed.data.published,
      isFeatured: parsed.data.isFeatured,
    };

    const productId = parsed.data.productId;
    if (productId === undefined) {
      const created = await getDb().transaction(async tx=>{
        const id=await createProduct(write,tx);
        await tx.insert(catalogAudit).values({id:randomUUID(),actorId:actor.userId,operation:"create-product",recordType:"product",recordId:id,revision:1,fields:JSON.stringify(["name","slug","description","categoryId","brand","ivaRate","isActive","published","isFeatured","saleMode","showPrice","dropiUrl"])});
        return id;
      });
      revalidatePath("/admin/productos");
      revalidarVidriera();
      return { ok: true, productId: created, revision:1 };
    }

    if(parsed.data.expectedRevision===undefined)throw catalogRevisionConflict();
    await getDb().transaction(async tx=>{
      await updateProduct(productId,write,tx);
      await tx.insert(catalogAudit).values({id:randomUUID(),actorId:actor.userId,operation:"save-product",recordType:"product",recordId:productId,revision:parsed.data.expectedRevision!+1,fields:JSON.stringify(["name","slug","description","categoryId","brand","ivaRate","isActive","published","isFeatured","saleMode","showPrice","dropiUrl"])});
    });
    revalidatePath("/admin/productos");
    revalidatePath(`/admin/productos/${productId}`);
    revalidarVidriera();
    return { ok: true, productId, revision:parsed.data.expectedRevision+1 };
  } catch (error) {
    return adminActionError("saveProduct", error);
  }
}

const VariantSchema = z.object({
  expectedRevision: z.number().int().positive().max(2147483646).optional(),
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  sku: z.string().trim().min(1, t("adminForm.sku")).max(64),
  label: z.string().trim().min(1, t("adminForm.etiquetaVariante")).max(120),
  // Enteros en guaraníes. Nada de decimales: el guaraní no tiene céntimos y un
  // float acá es el principio de un total que no cuadra.
  pricePyg: z.number().int(t("adminForm.precioEntero")).nonnegative(),
  compareAtPyg: z.number().int().nonnegative().nullable().optional(),
  isActive: z.boolean(),
  /**
   * Punto de reposición por variante (O6). Vacío = `null` = el umbral global.
   * El techo de 100.000 no es un número mágico: es lo que hace que un dedo
   * pesado sobre el teclado no deje una variante marcada como "stock bajo"
   * para siempre — el campo lo dibuja S10.
   */
  reorderPoint: z
    .number()
    .int()
    .nonnegative()
    .max(100_000)
    .nullable()
    .optional(),
});

export async function saveProductVariant(
  input: unknown
): Promise<AdminActionResult> {
  try {
    const actor=await requireStaffSession();

    const parsed = VariantSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Revisá los datos.",
      };
    }

    if(parsed.data.expectedRevision===undefined)throw catalogRevisionConflict();
    await getDb().transaction(async tx=>{
      const [current]=await tx.select({revision:products.revision}).from(products).where(eq(products.id,parsed.data.productId)).for("update");
      if(!current||current.revision!==parsed.data.expectedRevision)throw catalogRevisionConflict();
      if (parsed.data.variantId !== undefined) {
        const [variant] = await tx.select({id: variants.id}).from(variants).where(and(eq(variants.id, parsed.data.variantId), eq(variants.productId, parsed.data.productId))).for("update");
        if (!variant) throw catalogRevisionConflict();
      }
      await saveVariant(parsed.data.productId, {
      id: parsed.data.variantId,
      sku: parsed.data.sku,
      label: parsed.data.label,
      pricePyg: parsed.data.pricePyg,
      compareAtPyg: parsed.data.compareAtPyg ?? null,
      isActive: parsed.data.isActive,
      reorderPoint: parsed.data.reorderPoint ?? null,
    },tx);
      await tx.update(products).set({revision:sql`${products.revision}+1`}).where(eq(products.id,parsed.data.productId));
      await tx.insert(catalogAudit).values({id:randomUUID(),actorId:actor.userId,operation:"save-variant",recordType:"product",recordId:parsed.data.productId,revision:parsed.data.expectedRevision!+1,fields:JSON.stringify(["variants"])});
    });

    revalidatePath(`/admin/productos/${parsed.data.productId}`);
    revalidarVidriera();
    return { ok: true };
  } catch (error) {
    return adminActionError("saveProductVariant", error);
  }
}

const AdjustSchema = z.object({
  variantId: z.number().int().positive(),
  delta: z
    .number()
    .int()
    .refine((value) => value !== 0, t("adminForm.ajusteCero")),
  // El motivo es obligatorio acá y otra vez en el dominio: este mensaje es
  // para el formulario, el del dominio es la regla real.
  reason: z.string().trim().min(4, t("adminForm.motivoAjuste")).max(300),
  productId: z.number().int().positive().optional(),
});

/** Ajuste de stock con motivo. Queda auditado en `stock_adjustments`. */
export async function adjustVariantStock(
  input: unknown
): Promise<AdminActionResult<{ newOnHand: number }>> {
  try {
    const actor = await requireStaffSession();

    const parsed = AdjustSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Revisá los datos.",
      };
    }

    const result = await adjustStock({
      variantId: parsed.data.variantId,
      delta: parsed.data.delta,
      reason: parsed.data.reason,
      actor: actorLabel(actor),
      actorUserId: actor.userId,
    });

    if (parsed.data.productId)
      revalidatePath(`/admin/productos/${parsed.data.productId}`);
    revalidatePath("/admin/productos");
    revalidatePath("/admin");
    revalidarVidriera();
    return { ok: true, newOnHand: result.newOnHand };
  } catch (error) {
    return adminActionError("adjustVariantStock", error);
  }
}

/**
 * Subida de una foto de producto.
 *
 * Va a la carpeta pública `productos/` — al revés que los comprobantes, esto
 * tiene que servirse por CDN sin firmar. El tipo se valida por los bytes
 * antes de subir.
 */
export async function uploadProductImage(
  formData: FormData
): Promise<AdminActionResult<{revision?:number}>> {
  try {
    const actor=await requireStaffSession();

    const productId = Number(formData.get("productId"));
    if (!Number.isInteger(productId) || productId <= 0) {
      return { ok: false, error: t("adminError.productoInvalido") };
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: t("adminError.elegiFoto") };
    }

    const content = Buffer.from(await file.arrayBuffer());
    const { mime } = validateProductImage({
      bytes: content.byteLength,
      content,
    });

    const uploaded = await cloudinary.uploader.upload(
      `data:${mime};base64,${content.toString("base64")}`,
      { folder: carpetaProductos(), resource_type: "image", overwrite: false }
    );

    const alt = String(formData.get("alt") ?? "").trim();
    await getDb().transaction(async tx=>{
    await addProductImage({
      productId,
      cloudinaryId: uploaded.public_id,
      alt: alt === "" ? null : alt.slice(0, 255),
    },tx);
    const [version]=await tx.select({revision:products.revision}).from(products).where(eq(products.id,productId));
    await tx.insert(catalogAudit).values({id:randomUUID(),actorId:actor.userId,operation:"add-image",recordType:"product",recordId:productId,revision:version!.revision,fields:JSON.stringify(["images"])});
    });

    revalidatePath(`/admin/productos/${productId}`);
    revalidarVidriera();
    return { ok: true };
  } catch (error) {
    return adminActionError("uploadProductImage", error);
  }
}

const RemoveImageSchema = z.object({
  imageId: z.number().int().positive(),
  productId: z.number().int().positive(),
});

export async function removeProductImage(
  input: unknown
): Promise<AdminActionResult<{revision?:number;tombstoneId?:string}>> {
  try {
    const actor=await requireStaffSession();

    const parsed = RemoveImageSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: t("adminError.imagenInvalida") };
    }

    // Se borra sólo la fila. El archivo queda en Cloudinary a propósito: si
    // la imagen está referenciada en otro lado, borrarla del CDN rompe esa
    // página, y el costo de una foto huérfana es despreciable.
    await getDb().transaction(async tx=>{
      const [image]=await tx.select({id:productImages.id}).from(productImages).where(and(eq(productImages.id,parsed.data.imageId),eq(productImages.productId,parsed.data.productId))).for("update");
      if(!image)return;
      await deleteProductImage(parsed.data.imageId,tx);
      const [version]=await tx.select({revision:products.revision}).from(products).where(eq(products.id,parsed.data.productId));
      await tx.insert(catalogAudit).values({id:randomUUID(),actorId:actor.userId,operation:"remove-image",recordType:"product",recordId:parsed.data.productId,revision:version!.revision,fields:JSON.stringify(["images"])});
    });

    revalidatePath(`/admin/productos/${parsed.data.productId}`);
    revalidarVidriera();
    return { ok: true };
  } catch (error) {
    return adminActionError("removeProductImage", error);
  }
}

// ---------------------------------------------------------------------------
// Carga masiva por planilla (CSV/Excel) — `pnpm importar:productos` desde el
// panel.
//
// Dos acciones, no una: `previewCatalogImport` es el ensayo (cuenta y muestra
// errores, no escribe nada — el default de la CLI sin `--aplicar`) y
// `applyCatalogImport` recién escribe cuando el dueño confirma. El checkbox
// "pisar stock" es el equivalente de `--pisar-stock`: apagado por defecto,
// porque pisar en silencio el stock real de una variante que ya existe es
// justo el tipo de sorpresa que una planilla de semanas no debería poder dar.
// ---------------------------------------------------------------------------

const MAX_CATALOG_FILE_BYTES = 10 * 1024 * 1024;

export type CatalogImportSummary = {
  advertencias?: string[];
  productosNuevos: number;
  productosActualizar: number;
  variantesNuevas: number;
  variantesActualizar: number;
  categoriasNuevas: string[];
  pisaStock: boolean;
  fotosNuevas: number;
};

export type CatalogImportPreviewResult =
  ({ ok: true } & CatalogImportSummary) | { ok: false; errores: string[] };

async function readCatalogFile(
  formData: FormData
): Promise<{ ok: true; csvText: string } | { ok: false; errores: string[] }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, errores: [t("adminError.elegiArchivo")] };
  }
  if (file.size > MAX_CATALOG_FILE_BYTES) {
    return { ok: false, errores: [t("adminError.archivoGrande")] };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    return { ok: true, csvText: await spreadsheetToCsvText(file.name, bytes) };
  } catch (error) {
    if (error instanceof UnsupportedSpreadsheetError) {
      return { ok: false, errores: [error.message] };
    }
    throw error;
  }
}

function planSummary(
  plan: CatalogImportPlan,
  pisaStock: boolean
): CatalogImportSummary {
  return {
    advertencias: plan.advertencias,
    productosNuevos: plan.productosNuevos,
    productosActualizar: plan.productosActualizar,
    variantesNuevas: plan.variantesNuevas,
    variantesActualizar: plan.variantesActualizar,
    categoriasNuevas: plan.categoriasNuevas,
    pisaStock,
    fotosNuevas: plan.fotosNuevas,
  };
}

/**
 * Ensayo: cuenta y muestra, no escribe nada. Es lo que se ve antes de
 * habilitar el botón de confirmar.
 */
export async function previewCatalogImport(
  formData: FormData
): Promise<CatalogImportPreviewResult> {
  try {
    await requireStaffSession();

    const leido = await readCatalogFile(formData);
    if (!leido.ok) return { ok: false, errores: leido.errores };

    const pisaStock = formData.get("pisarStock") === "true";
    const plan = await buildCatalogImportPlan(leido.csvText);
    if (plan.errores.length > 0) return { ok: false, errores: plan.errores };

    return { ok: true, ...planSummary(plan, pisaStock) };
  } catch (error) {
    const result = adminActionError("previewCatalogImport", error);
    return { ok: false, errores: [result.error] };
  }
}

export type CatalogImportApplyResult =
  | ({ ok: true } & CatalogImportSummary & {
        stagedReady?:boolean;
        importId?:string;
        nextOffset?:number|null;
        totalProducts?:number;
        variantesEscritas: number;
        fotosSubidas: number;
        fotosOmitidas: number;
        fotosFallidas: CatalogFotoFallida[];
      })
  | { ok: false; errores: string[] };

/**
 * Escribe. Vuelve a parsear y a chequear conflictos de SKU contra la base
 * **en este momento** — no reutiliza el plan del ensayo — porque entre la
 * vista previa y la confirmación pudo haber pasado cualquier cosa (otra
 * persona cargando productos, por ejemplo) y aplicar un plan viejo sería
 * escribir sobre un estado que ya no es el real.
 */
export async function applyCatalogImport(
  formData: FormData
): Promise<CatalogImportApplyResult> {
  try {
    const actor=await requireStaffSession();

    const leido = await readCatalogFile(formData);
    if (!leido.ok) return { ok: false, errores: leido.errores };

    const pisaStock = formData.get("pisarStock") === "true";
    const plan = await buildCatalogImportPlan(leido.csvText);
    if (plan.errores.length > 0) return { ok: false, errores: plan.errores };

    if (
      plan.advertencias?.length &&
      formData.get("duplicateReview") !== JSON.stringify(plan.advertencias)
    )
      return {
        ok: false,
        errores: [t("panel.productos.importar.faltaRevision")],
      };

    const categoriaPorSlug = await ensureCatalogCategories(plan);

    const items: CatalogProductUpsert[] = plan.productos.map(
      (producto: CatalogoProducto) => {
        const categoryId = categoriaPorSlug.get(slugify(producto.categoryName));
        if (!categoryId)
          throw new Error(`Categoría sin id: ${producto.categoryName}`);
        return {
          saleMode: producto.saleMode,
          showPrice: producto.showPrice,
          slug: producto.slug,
          name: producto.name,
          description: producto.description,
          categoryId,
          brand: producto.brand,
          dropiUrl: producto.dropiUrl,
          ivaRate: producto.ivaRate,
          variants: producto.variants,
        };
      }
    );

    const variantesEscritas = await upsertCatalogProducts(items, {
      resetStock: pisaStock,
      actorId:actor.userId,
    });

    // "Avisame cuando haya stock" (O6): una importación con `pisarStock` es la
    // otra forma en que `on_hand` sube sin pasar por `adjustStock`. Se dispara
    // el barrido —que ya sabe qué variantes tienen suscripciones pendientes y
    // disponibilidad— y no un aviso por variante: la planilla puede traer
    // doscientas filas y sólo un puñado interesa a alguien.
    //
    // Después del commit, sin `await` que demore y sin poder fallar: quien
    // acaba de importar el catálogo no espera por Meta.
    if (pisaStock) {
      void sweepBackInStock().catch((error) => {
        console.error("sweepBackInStock rechazó", safeError(error).message);
      });
    }

    // Las fotos van después del commit del catálogo: una que falla (URL
    // caída, Cloudinary con hipo) no puede tumbar productos y precios que ya
    // se guardaron. Se juntan los fallos en `fotosFallidas` en vez de tirar.
    const fotos = await applyCatalogFotos(plan.productos,undefined,actor.userId);

    revalidatePath("/admin/productos");
    revalidarVidriera();
    return {
      ok: true,
      ...planSummary(plan, pisaStock),
      variantesEscritas,
      fotosSubidas: fotos.fotosSubidas,
      fotosOmitidas: fotos.fotosOmitidas,
      fotosFallidas: fotos.fotosFallidas,
    };
  } catch (error) {
    const result = adminActionError("applyCatalogImport", error);
    return { ok: false, errores: [result.error] };
  }
}

/* ---------------------------------------------------------------------------
 * Acciones masivas y duplicar (O7, plan-operacion §5.3 B y C)
 *
 * Las tres primeras son `productos` (staff): publicar, despublicar y mover de
 * categoría es trabajo de catálogo. La de precios es **owner**, porque es la
 * única que mueve plata — ver el comentario de `precios.masivo` en
 * `permissions.ts`.
 * ------------------------------------------------------------------------- */

const BulkIdsSchema = z.object({
  productIds: z.array(z.number().int().positive()).min(1).max(BULK_MAX_IDS),
});

export async function bulkSetProductsActive(
  input: unknown
): Promise<AdminActionResult<{ afectados: number }>> {
  try {
    await requireStaffSession();

    const parsed = BulkIdsSchema.extend({ isActive: z.boolean() }).safeParse(
      input
    );
    if (!parsed.success)
      return { ok: false, error: t("adminError.noEntendi.masivo") };

    const afectados = await bulkSetActive(
      parsed.data.productIds,
      parsed.data.isActive
    );

    revalidatePath("/admin/productos");
    revalidarVidriera();
    return { ok: true, afectados };
  } catch (error) {
    return adminActionError("bulkSetProductsActive", error);
  }
}

export async function bulkMoveProductsCategory(
  input: unknown
): Promise<AdminActionResult<{ afectados: number }>> {
  try {
    await requireStaffSession();

    const parsed = BulkIdsSchema.extend({
      categoryId: z.number().int().positive(),
    }).safeParse(input);
    if (!parsed.success)
      return { ok: false, error: t("adminError.noEntendi.masivo") };

    const afectados = await bulkMoveCategory(
      parsed.data.productIds,
      parsed.data.categoryId
    );

    revalidatePath("/admin/productos");
    revalidarVidriera();
    return { ok: true, afectados };
  } catch (error) {
    return adminActionError("bulkMoveProductsCategory", error);
  }
}

/**
 * El porcentaje y los ids viajan; **los precios no**. Cada precio nuevo lo
 * calcula el servidor releyendo el viejo con la fila bloqueada.
 */
const BulkPriceSchema = z
  .object({
    variantIds: z
      .array(z.number().int().positive())
      .max(BULK_MAX_IDS)
      .optional(),
    productIds: z
      .array(z.number().int().positive())
      .max(BULK_MAX_IDS)
      .optional(),
    percent: z.number().int().min(PERCENT_MIN).max(PERCENT_MAX),
    roundTo: z.union([z.literal(100), z.literal(1000)]),
    reason: z.string().trim().min(BULK_MIN_REASON).max(500),
  })
  .refine(
    (data) =>
      Boolean(data.variantIds?.length) !== Boolean(data.productIds?.length),
    // Una de las dos, no las dos ni ninguna: con las dos, no está claro cuál
    // gana, y "las dos" es siempre un error de quien llama.
    { message: "Elegí variantes o productos, no las dos cosas." }
  );

export async function bulkAdjustProductPrices(input: unknown): Promise<
  AdminActionResult<{
    cambiadas: number;
    miradas: number;
    diferenciaPyg: number;
  }>
> {
  try {
    const actor = await requireOwnerSession();

    const parsed = BulkPriceSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message ?? t("adminError.noEntendi.masivo"),
      };
    }

    const result = await bulkAdjustPrices({
      variantIds: parsed.data.variantIds,
      productIds: parsed.data.productIds,
      percent: parsed.data.percent,
      roundTo: parsed.data.roundTo,
      reason: parsed.data.reason,
      actor: actorLabel(actor),
      actorUserId: actor.userId,
    });

    revalidatePath("/admin/productos");
    revalidarVidriera();
    return { ok: true, ...result };
  } catch (error) {
    return adminActionError("bulkAdjustProductPrices", error);
  }
}

/** La vista previa del ajuste. Owner también: muestra precios y no escribe. */
export async function previewBulkPriceAdjustment(input: unknown): Promise<
  AdminActionResult<{
    cambiadas: number;
    miradas: number;
    diferenciaPyg: number;
    ejemplos: Array<{ variantId: number; from: number; to: number }>;
  }>
> {
  try {
    await requireOwnerSession();

    const parsed = BulkPriceSchema.omit({ reason: true }).safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message ?? t("adminError.noEntendi.masivo"),
      };
    }

    const result = await previewPriceAdjustment({
      variantIds: parsed.data.variantIds,
      productIds: parsed.data.productIds,
      percent: parsed.data.percent,
      roundTo: parsed.data.roundTo,
    });

    return { ok: true, ...result };
  } catch (error) {
    return adminActionError("previewBulkPriceAdjustment", error);
  }
}

/**
 * Duplicar un producto. La copia nace despublicada y con stock 0; **no lleva
 * las fotos** (ver el comentario de `duplicateProduct`).
 */
export async function duplicateProductAction(
  input: unknown
): Promise<AdminActionResult<{ productId: number }>> {
  try {
    await requireStaffSession();

    const parsed = z
      .object({ productId: z.number().int().positive() })
      .safeParse(input);
    if (!parsed.success)
      return { ok: false, error: t("adminError.noEntendi.masivo") };

    const productId = await duplicateProduct(parsed.data.productId);

    revalidatePath("/admin/productos");
    revalidarVidriera();
    return { ok: true, productId };
  } catch (error) {
    return adminActionError("duplicateProductAction", error);
  }
}

export async function editProductImage(_input:unknown):Promise<AdminActionResult<{revision:number}>> {await requireStaffSession();void _input;return{ok:false,error:"Esta función requiere el catálogo nativo."};}
export async function reorderProductImages(_input:unknown):Promise<AdminActionResult<{revision:number}>> {await requireStaffSession();void _input;return{ok:false,error:"Esta función requiere el catálogo nativo."};}
export async function restoreProductImage(_input:unknown):Promise<AdminActionResult<{revision:number}>> {await requireStaffSession();void _input;return{ok:false,error:"Esta función requiere el catálogo nativo."};}

export async function listRemovedProductImages(_input:unknown):Promise<AdminActionResult<{images:Array<{id:string;alt:string|null}>}>>{await requireStaffSession();void _input;return{ok:true,images:[]};}

/** Native Workers replaces this body with its actor-bound atomic publisher. */
export async function publishCatalogImport(input:{importId:string}):Promise<CatalogImportApplyResult>{
  void input;
  await requireStaffSession();
  return {ok:false,errores:["La publicación completa está disponible en el catálogo nativo."]};
}
