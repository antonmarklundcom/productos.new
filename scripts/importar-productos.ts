import "@/lib/load-env";

import { safeError } from "../src/lib/safe-error";

import { readFileSync } from "node:fs";

import { eq, inArray, sql } from "drizzle-orm";

import { closePool, getDb } from "@/db";
import { categories, products, variants } from "@/db/schema";
import { parseCatalogo, type CatalogoProducto } from "@/domain/catalog-import";
import { slugify } from "@/lib/slug";

import {
  applyCatalogFotos,
  contarFotosNuevas,
} from "@/domain/catalog-import-plan";

import { upsertCatalogProducts, type CatalogProductUpsert } from "./seed";

/**
 * `pnpm importar:productos <planilla.csv>` — el catálogo entero de una vez.
 *
 * El cuello de botella real de una tienda nueva no es el deploy: es cargar
 * cien productos a mano en `/admin/productos`. El comercio ya tiene su lista
 * de precios en Excel; esto la sube.
 *
 * El formato es el del export del panel (una fila por variante; SKU,
 * Producto, Categoría, Variante, Precio (₲), Stock) más columnas opcionales:
 * Descripción, Marca, IVA, Precio antes (₲), Slug y Fotos. Separador `;` o
 * `,`, como venga. La validación vive en `src/domain/catalog-import.ts` y
 * este script sólo agrega lo que necesita base: qué categoría existe, de
 * quién es cada SKU, y el upsert compartido con el seed.
 *
 * **Fotos**: URLs `https://` separadas por `|`, espacio o salto de línea —
 * Cloudinary las va a buscar solo, este script nunca las descarga. Sólo se
 * suben a un producto que hoy no tiene ninguna foto, igual que una carga a
 * mano; si Cloudinary no está configurado se avisa y se sigue sin ellas.
 *
 * Ejemplo de fila completa, con dos fotos:
 *
 *   AUR-1;Auriculares TWS;Electrónica;Negro;285000;24;;;;;;https://cdn.tienda.com/aur-1.jpg|https://cdn.tienda.com/aur-1b.jpg
 *
 * **Ensayo por defecto**: sin `--aplicar` cuenta y muestra, no escribe.
 *
 *   pnpm importar:productos lista.csv                # ensayo
 *   pnpm importar:productos lista.csv --aplicar      # escribe
 *   pnpm importar:productos lista.csv --aplicar --pisar-stock
 *
 * Idempotente (mismas claves que el seed: `slug` y `sku`): re-correrlo
 * actualiza precios y textos sin duplicar, y el `on_hand` de variantes que ya
 * existen no se toca salvo `--pisar-stock`. Las categorías que no existan se
 * crean al final del menú.
 */

const APLICAR = process.argv.includes("--aplicar");
const PISAR_STOCK = process.argv.includes("--pisar-stock");

async function main(): Promise<void> {
  const archivo = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  if (!archivo) {
    console.error(
      "Uso: pnpm importar:productos <planilla.csv> [--aplicar] [--pisar-stock]"
    );
    process.exitCode = 1;
    return;
  }

  let texto: string;
  try {
    texto = readFileSync(archivo, "utf8");
  } catch {
    console.error(`No pude leer "${archivo}". ¿La ruta está bien?`);
    process.exitCode = 1;
    return;
  }

  const { productos, errores } = parseCatalogo(texto);
  if (errores.length > 0) {
    for (const error of errores) console.error(`✗ ${error}`);
    console.error(`\n${errores.length} error(es). No se escribió nada.`);
    process.exitCode = 1;
    return;
  }

  const db = getDb();

  // --- Categorías: cuáles existen, cuáles hay que crear -------------------
  const categoryRows = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories);
  const categoriaPorSlug = new Map<string, number>();
  for (const row of categoryRows) {
    categoriaPorSlug.set(row.slug, row.id);
    categoriaPorSlug.set(slugify(row.name), row.id);
  }

  const categoriasNuevas = new Map<string, string>(); // slug → nombre como vino
  for (const producto of productos) {
    const slug = slugify(producto.categoryName);
    if (!categoriaPorSlug.has(slug) && !categoriasNuevas.has(slug)) {
      categoriasNuevas.set(slug, producto.categoryName);
    }
  }

  // --- SKUs: uno que ya existe en OTRO producto es un error, no un update.
  // El upsert re-colgaría la variante del producto de la planilla en
  // silencio, y "mover una variante de producto" no es algo que una planilla
  // tenga permitido decidir sin que nadie lo vea.
  const skus = productos.flatMap((p) => p.variants.map((v) => v.sku));
  const skuRows = skus.length
    ? await db
        .select({ sku: variants.sku, productSlug: products.slug })
        .from(variants)
        .innerJoin(products, eq(variants.productId, products.id))
        .where(inArray(variants.sku, skus))
    : [];
  const duenoDeSku = new Map(skuRows.map((row) => [row.sku, row.productSlug]));

  const conflictos: string[] = [];
  for (const producto of productos) {
    for (const variante of producto.variants) {
      const dueno = duenoDeSku.get(variante.sku);
      if (dueno !== undefined && dueno !== producto.slug) {
        conflictos.push(
          `✗ El SKU "${variante.sku}" ya existe en la base y es del producto "${dueno}", no de "${producto.slug}". Cambiá el SKU o el slug en la planilla.`
        );
      }
    }
  }
  if (conflictos.length > 0) {
    for (const conflicto of conflictos) console.error(conflicto);
    console.error(
      `\n${conflictos.length} conflicto(s) de SKU. No se escribió nada.`
    );
    process.exitCode = 1;
    await closePool();
    return;
  }

  // --- El plan ------------------------------------------------------------
  const slugsProductos = productos.map((p) => p.slug);
  const productRows = await db
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .where(inArray(products.slug, slugsProductos));
  const idPorSlugExistente = new Map(
    productRows.map((row) => [row.slug, row.id])
  );
  const productosExistentes = new Set(productRows.map((row) => row.slug));
  const nuevos = productos.filter((p) => !productosExistentes.has(p.slug));
  const variantesTotal = skus.length;
  const variantesExistentes = duenoDeSku.size;
  const fotosNuevas = await contarFotosNuevas(
    productos,
    idPorSlugExistente,
    db
  );

  console.log(
    `Planilla: ${productos.length} productos · ${variantesTotal} variantes`
  );
  console.log(
    `  · ${nuevos.length} productos nuevos, ${productos.length - nuevos.length} a actualizar`
  );
  console.log(
    `  · ${variantesTotal - variantesExistentes} variantes nuevas, ${variantesExistentes} a actualizar` +
      (variantesExistentes > 0
        ? PISAR_STOCK
          ? " (¡pisando su stock!)"
          : " (su stock no se toca; --pisar-stock para pisarlo)"
        : "")
  );
  if (categoriasNuevas.size > 0) {
    console.log(
      `  · categorías a crear: ${[...categoriasNuevas.values()].join(", ")}`
    );
  }
  if (fotosNuevas > 0) {
    console.log(
      `  · ${fotosNuevas} fotos a subir (sólo a productos que hoy no tienen ninguna)`
    );
  }

  if (!APLICAR) {
    console.log(
      "\nEnsayo: no se escribió nada. Agregá --aplicar para escribir."
    );
    await closePool();
    return;
  }

  // --- Escribir -----------------------------------------------------------
  if (categoriasNuevas.size > 0) {
    const maxPosition =
      (
        await db
          .select({
            max: sql<number>`COALESCE(MAX(${categories.position}), 0)`,
          })
          .from(categories)
      )[0]?.max ?? 0;
    let position = maxPosition;
    for (const [slug, nombre] of categoriasNuevas) {
      position += 1;
      await db
        .insert(categories)
        .values({ slug, name: nombre, position })
        .onDuplicateKeyUpdate({ set: { name: nombre, isActive: true } });
      const fila = (
        await db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.slug, slug))
          .limit(1)
      )[0];
      if (!fila) throw new Error(`No pude releer la categoría ${slug}`);
      categoriaPorSlug.set(slug, fila.id);
    }
    console.log(`✓ ${categoriasNuevas.size} categorías creadas`);
  }

  const items: CatalogProductUpsert[] = productos.map(
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
        ivaRate: producto.ivaRate,
        variants: producto.variants,
      };
    }
  );

  const escritas = await upsertCatalogProducts(items, {
    resetStock: PISAR_STOCK,
  });
  console.log(
    `✓ ${productos.length} productos · ${escritas} variantes escritas`
  );

  // Las fotos van después del commit del catálogo: una URL caída no puede
  // tumbar productos y precios que ya se guardaron.
  const fotos = await applyCatalogFotos(productos);
  if (fotos.fotosOmitidas > 0) {
    console.log(
      `⚠ ${fotos.fotosOmitidas} fotos NO se subieron: Cloudinary no está configurado (ver docs/ENV-OPCIONAL.md).`
    );
  } else if (fotos.fotosSubidas > 0 || fotos.fotosFallidas.length > 0) {
    console.log(`✓ ${fotos.fotosSubidas} fotos subidas`);
  }
  for (const fallo of fotos.fotosFallidas) {
    console.error(
      `✗ Foto de "${fallo.producto}" (${fallo.url}) no se pudo subir: ${fallo.motivo}`
    );
  }
}

main()
  .then(() => closePool())
  .catch(async (error) => {
    console.error(safeError(error).message);
    process.exitCode = 1;
    await closePool();
  });
