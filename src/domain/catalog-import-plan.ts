import { safeError } from "@/lib/safe-error";
import { count, eq, inArray, sql } from "drizzle-orm";

import { categories, productImages, products, variants } from "@/db/schema";
import { getDb } from "@/db";
import { slugify } from "@/lib/slug";
import {
  carpetaProductos,
  cloudinary,
  cloudinaryConfigured,
} from "@/lib/cloudinary";
import { cargarIntegraciones } from "@/lib/integraciones-store";

import { addProductImage } from "./admin-products";
import { parseCatalogo, type CatalogoProducto } from "./catalog-import";
import type { Executor } from "./executor";

/**
 * El mismo camino de `scripts/importar-productos.ts` (categoría por resolver,
 * SKU de quién es, plan de qué se va a escribir), pero como función que
 * también puede llamar `/admin/productos` y no sólo la CLI.
 *
 * El parseo (`parseCatalogo`) y la escritura (`upsertCatalogProducts`, en
 * `scripts/seed.ts`) siguen siendo los mismos de siempre — esto es sólo el
 * pegamento que mira la base para armar el plan y, si corresponde, aplicarlo.
 */

export type CatalogImportPlan = {
  productos: CatalogoProducto[];
  /** Parseo + conflictos de SKU. Si hay al menos uno, no se puede aplicar. */
  errores: string[];
  productosNuevos: number;
  productosActualizar: number;
  variantesNuevas: number;
  variantesActualizar: number;
  /** Nombre tal como vino en la planilla, para mostrarlo en la vista previa. */
  categoriasNuevas: string[];
  categoriaIdPorSlug: Map<string, number>;
  /**
   * Fotos que `applyCatalogFotos` subiría: sólo cuentan las de un producto
   * que hoy no tiene NINGUNA foto (nuevo, o existente sin fotos todavía) —
   * la misma regla de "primera carga" que evita duplicar en un reimport.
   */
  fotosNuevas: number;
};

/**
 * Arma el plan sin escribir nada: ensayo, igual que `importar-productos.ts`
 * sin `--aplicar`. `buildCatalogImportPlan` + `applyCatalogImportPlan` son dos
 * pasos separados a propósito, así el panel puede mostrar la vista previa y
 * recién escribir cuando alguien la confirma.
 */
export async function buildCatalogImportPlan(
  csvText: string,
  executor?: Executor
): Promise<CatalogImportPlan> {
  const tx = executor ?? getDb();
  const { productos, errores: erroresParseo } = parseCatalogo(csvText);

  if (erroresParseo.length > 0) {
    return {
      productos: [],
      errores: erroresParseo,
      productosNuevos: 0,
      productosActualizar: 0,
      variantesNuevas: 0,
      variantesActualizar: 0,
      categoriasNuevas: [],
      categoriaIdPorSlug: new Map(),
      fotosNuevas: 0,
    };
  }

  const categoryRows = await tx
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories);
  const categoriaPorSlug = new Map<string, number>();
  for (const row of categoryRows) {
    categoriaPorSlug.set(row.slug, row.id);
    categoriaPorSlug.set(slugify(row.name), row.id);
  }

  const categoriasNuevas = new Map<string, string>();
  for (const producto of productos) {
    const slug = slugify(producto.categoryName);
    if (!categoriaPorSlug.has(slug) && !categoriasNuevas.has(slug)) {
      categoriasNuevas.set(slug, producto.categoryName);
    }
  }

  // Un SKU que ya es de OTRO producto es un conflicto, no un update: ver el
  // comentario homólogo en `scripts/importar-productos.ts`.
  const skus = productos.flatMap((p) => p.variants.map((v) => v.sku));
  const skuRows = skus.length
    ? await tx
        .select({ sku: variants.sku, productSlug: products.slug })
        .from(variants)
        .innerJoin(products, eq(variants.productId, products.id))
        .where(inArray(variants.sku, skus))
    : [];
  const duenoDeSku = new Map(skuRows.map((row) => [row.sku, row.productSlug]));

  const errores: string[] = [];
  for (const producto of productos) {
    for (const variante of producto.variants) {
      const dueno = duenoDeSku.get(variante.sku);
      if (dueno !== undefined && dueno !== producto.slug) {
        errores.push(
          `El SKU "${variante.sku}" ya existe en la base y es del producto "${dueno}", no de "${producto.slug}". Cambiá el SKU o el slug en la planilla.`
        );
      }
    }
  }
  if (errores.length > 0) {
    return {
      productos: [],
      errores,
      productosNuevos: 0,
      productosActualizar: 0,
      variantesNuevas: 0,
      variantesActualizar: 0,
      categoriasNuevas: [],
      categoriaIdPorSlug: new Map(),
      fotosNuevas: 0,
    };
  }

  const slugsProductos = productos.map((p) => p.slug);
  const productRows = await tx
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .where(inArray(products.slug, slugsProductos));
  const idPorSlugExistente = new Map(
    productRows.map((row) => [row.slug, row.id])
  );
  const productosExistentes = new Set(productRows.map((row) => row.slug));
  const productosNuevos = productos.filter(
    (p) => !productosExistentes.has(p.slug)
  ).length;
  const variantesTotal = skus.length;
  const variantesExistentes = duenoDeSku.size;
  const fotosNuevas = await contarFotosNuevas(
    productos,
    idPorSlugExistente,
    tx
  );

  return {
    productos,
    errores: [],
    productosNuevos,
    productosActualizar: productos.length - productosNuevos,
    variantesNuevas: variantesTotal - variantesExistentes,
    variantesActualizar: variantesExistentes,
    categoriasNuevas: [...categoriasNuevas.values()],
    categoriaIdPorSlug: categoriaPorSlug,
    fotosNuevas,
  };
}

/**
 * Cuántas fotos de la planilla se subirían de verdad: sólo las de un
 * producto sin ninguna foto todavía (nuevo, o existente con cero filas en
 * `product_images`) — la misma pregunta que se hace `applyCatalogFotos`
 * antes de subir, para que la vista previa no prometa de más.
 */
export async function contarFotosNuevas(
  productos: readonly CatalogoProducto[],
  idPorSlugExistente: Map<string, number>,
  tx: Executor
): Promise<number> {
  const conFotos = productos.filter((p) => p.fotos.length > 0);
  if (conFotos.length === 0) return 0;

  const idsExistentesConFotos = conFotos
    .map((p) => idPorSlugExistente.get(p.slug))
    .filter((id): id is number => id !== undefined);

  const tieneFotos = new Set(
    await productIdsConFotos(idsExistentesConFotos, tx)
  );

  let total = 0;
  for (const producto of conFotos) {
    const id = idPorSlugExistente.get(producto.slug);
    if (id !== undefined && tieneFotos.has(id)) continue; // ya tiene fotos: no se tocan.
    total += producto.fotos.length;
  }
  return total;
}

/** IDs de producto, de entre los pasados, que ya tienen al menos una foto. */
async function productIdsConFotos(
  productIds: number[],
  tx: Executor
): Promise<number[]> {
  if (productIds.length === 0) return [];
  const filas = await tx
    .select({ productId: productImages.productId, total: count() })
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .groupBy(productImages.productId);
  return filas.filter((f) => f.total > 0).map((f) => f.productId);
}

export type CatalogFotoFallida = {
  producto: string;
  url: string;
  motivo: string;
};

export type CatalogFotosResult = {
  /** Cuántas fotos se subieron y quedaron registradas. */
  fotosSubidas: number;
  /** Cuántas fotos NO se intentaron subir porque Cloudinary no está configurado. */
  fotosOmitidas: number;
  /** Cada URL que se intentó y falló, sin frenar el resto de la importación. */
  fotosFallidas: CatalogFotoFallida[];
};

const FOTOS_CONCURRENCIA = 4;

/**
 * Sube las fotos de `productos` a Cloudinary y las registra con
 * `addProductImage` — sólo para un producto que hoy no tiene ninguna, igual
 * que `contarFotosNuevas` (así reimportar la misma planilla nunca duplica).
 *
 * Se llama **después** de que el upsert de `upsertCatalogProducts` ya
 * commiteó: una foto que falla no puede tumbar productos y precios que sí
 * se guardaron. Por eso nunca tira — junta los fallos en `fotosFallidas`.
 *
 * Sin credenciales de Cloudinary, no se intenta ni una subida: se cuentan
 * como `fotosOmitidas` para que quien llama avise con un mensaje claro, no
 * con un error.
 *
 * Es Cloudinary quien va a buscar la URL (`resource_type: "image"` con la
 * URL como fuente) — este server nunca hace un `fetch` de la foto.
 */
export async function applyCatalogFotos(
  productos: readonly CatalogoProducto[],
  executor?: Executor
): Promise<CatalogFotosResult> {
  const tx = executor ?? getDb();
  const conFotos = productos.filter((p) => p.fotos.length > 0);
  if (conFotos.length === 0) {
    return { fotosSubidas: 0, fotosOmitidas: 0, fotosFallidas: [] };
  }

  // Cloudinary puede venir de /admin/integraciones (también desde el script).
  await cargarIntegraciones();
  if (!cloudinaryConfigured()) {
    const total = conFotos.reduce((acc, p) => acc + p.fotos.length, 0);
    return { fotosSubidas: 0, fotosOmitidas: total, fotosFallidas: [] };
  }

  const slugs = conFotos.map((p) => p.slug);
  const rows = await tx
    .select({ id: products.id, slug: products.slug, name: products.name })
    .from(products)
    .where(inArray(products.slug, slugs));
  const porSlug = new Map(rows.map((row) => [row.slug, row]));
  const tieneFotos = new Set(
    await productIdsConFotos(
      rows.map((row) => row.id),
      tx
    )
  );

  const grupos = conFotos
    .map((producto) => {
      const row = porSlug.get(producto.slug);
      if (!row || tieneFotos.has(row.id)) return null;
      return { productId: row.id, nombre: row.name, urls: producto.fotos };
    })
    .filter(
      (grupo): grupo is { productId: number; nombre: string; urls: string[] } =>
        grupo !== null
    );

  let fotosSubidas = 0;
  const fotosFallidas: CatalogFotoFallida[] = [];

  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const grupo = grupos[cursor++];
      if (!grupo) return;
      // Secuencial adentro del mismo producto: `addProductImage` calcula la
      // posición contando las filas que ya existen, y subir dos fotos del
      // mismo producto en paralelo las haría pelear por la posición 0.
      for (const [index, url] of grupo.urls.entries()) {
        try {
          const uploaded = await cloudinary.uploader.upload(url, {
            folder: carpetaProductos(),
            resource_type: "image",
          });
          await addProductImage(
            {
              productId: grupo.productId,
              cloudinaryId: uploaded.public_id,
              alt:
                index === 0
                  ? grupo.nombre
                  : `${grupo.nombre} — foto ${index + 1}`,
            },
            tx
          );
          fotosSubidas += 1;
        } catch (error) {
          fotosFallidas.push({
            producto: grupo.nombre,
            url,
            motivo: safeError(error).message,
          });
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(FOTOS_CONCURRENCIA, grupos.length) }, () =>
      worker()
    )
  );

  return { fotosSubidas, fotosOmitidas: 0, fotosFallidas };
}

/**
 * Crea las categorías que falten y devuelve el mapa de slug de categoría → id
 * actualizado, listo para armar los `CatalogProductUpsert` que espera
 * `upsertCatalogProducts`.
 */
export async function ensureCatalogCategories(
  plan: Pick<CatalogImportPlan, "productos" | "categoriaIdPorSlug">,
  executor?: Executor
): Promise<Map<string, number>> {
  const tx = executor ?? getDb();
  const categoriaPorSlug = new Map(plan.categoriaIdPorSlug);

  const faltantes = new Map<string, string>();
  for (const producto of plan.productos) {
    const slug = slugify(producto.categoryName);
    if (!categoriaPorSlug.has(slug) && !faltantes.has(slug)) {
      faltantes.set(slug, producto.categoryName);
    }
  }
  if (faltantes.size === 0) return categoriaPorSlug;

  const maxPosition =
    (
      await tx
        .select({ max: sql<number>`COALESCE(MAX(${categories.position}), 0)` })
        .from(categories)
    )[0]?.max ?? 0;
  let position = maxPosition;
  for (const [slug, nombre] of faltantes) {
    position += 1;
    await tx
      .insert(categories)
      .values({ slug, name: nombre, position })
      .onDuplicateKeyUpdate({ set: { name: nombre, isActive: true } });
    const fila = (
      await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, slug))
        .limit(1)
    )[0];
    if (!fila) throw new Error(`No pude releer la categoría ${slug}`);
    categoriaPorSlug.set(slug, fila.id);
  }
  return categoriaPorSlug;
}
