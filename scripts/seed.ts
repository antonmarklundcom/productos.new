import "@/lib/load-env";

import { eq, sql } from "drizzle-orm";

import { closePool, getDb } from "@/db";
import { categories, products, shippingZones, variants } from "@/db/schema";
import { assertGs } from "@/lib/money";
import { safeError } from "@/lib/safe-error";

import {
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_SHIPPING_ZONES,
} from "./seed-data";

/**
 * Seed idempotente: se puede correr N veces.
 *
 * Las claves naturales son `slug` (categorías, productos, zonas) y `sku`
 * (variantes); todo entra con `ON DUPLICATE KEY UPDATE`, así que re-sembrar
 * actualiza precios y textos **sin** duplicar filas ni pisar `on_hand` de
 * variantes ya existentes… salvo que se pida con `--reset-stock`.
 */
const RESET_STOCK = process.argv.includes("--reset-stock");

/** Una zona tal como la escribe el seed o el cuerpo de `/api/setup/init`. */
export type SeedShippingZone = {
  slug: string;
  name: string;
  cities: readonly string[];
  pricePyg: number;
  freeThresholdPyg: number | null;
  position: number;
};

/**
 * Alta o actualización de zonas de envío, por `slug`.
 *
 * Exportada aparte del seed porque la usan dos caminos: `pnpm db:seed`, con
 * las zonas de ejemplo de Gran Asunción, y `POST /api/setup/init`, con las
 * zonas reales de la tienda en el cuerpo (PLAN.md FASE 2, PR U). Un segundo
 * upsert escrito a mano en la ruta sería un segundo lugar donde olvidarse del
 * `assertGs`, que es lo único que separa un flete en guaraníes enteros de un
 * `35000.5` guardado en una columna de plata.
 *
 * Idempotente por `slug`: re-correrlo actualiza precios, ciudades y orden sin
 * duplicar filas. **No borra las zonas que no vengan en la lista** — borrar
 * una zona que la tienda usa es exactamente el tipo de daño que un curl
 * repetido no tiene que poder hacer.
 */
export async function upsertShippingZones(
  zonas: readonly SeedShippingZone[],
  executor?: ReturnType<typeof getDb>
): Promise<number> {
  const db = executor ?? getDb();

  for (const zone of zonas) {
    assertGs(zone.pricePyg, `shipping_zones.${zone.slug}.price_pyg`);
    if (zone.freeThresholdPyg !== null) {
      assertGs(
        zone.freeThresholdPyg,
        `shipping_zones.${zone.slug}.free_threshold_pyg`
      );
    }

    await db
      .insert(shippingZones)
      .values({
        slug: zone.slug,
        name: zone.name,
        cities: [...zone.cities],
        pricePyg: zone.pricePyg,
        freeThresholdPyg: zone.freeThresholdPyg,
        position: zone.position,
      })
      .onDuplicateKeyUpdate({
        set: {
          name: zone.name,
          cities: [...zone.cities],
          pricePyg: zone.pricePyg,
          freeThresholdPyg: zone.freeThresholdPyg,
          position: zone.position,
          isActive: true,
        },
      });
  }

  return zonas.length;
}

/**
 * Un producto listo para escribir: categoría ya resuelta a id, montos en
 * guaraníes enteros. Es lo que comparten los dos caminos que escriben
 * catálogo — `pnpm db:seed` (datos de ejemplo) y `pnpm importar:productos`
 * (la planilla del comercio). Un segundo upsert a mano en el import sería un
 * segundo lugar donde olvidarse del `assertGs` o del "no pisar `on_hand`".
 */
export type CatalogProductUpsert = {
  saleMode?: "stock" | "enquiry" | "showcase";
  showPrice?: boolean;
  slug: string;
  name: string;
  description: string | null;
  categoryId: number;
  brand: string | null;
  ivaRate: number;
  variants: Array<{
    sku: string;
    label: string;
    pricePyg: number;
    compareAtPyg: number | null;
    onHand: number;
  }>;
};

/**
 * Alta o actualización de productos y variantes, por `slug` y `sku`.
 *
 * Idempotente. `publishedAt` se escribe **sólo al insertar**: re-importar la
 * misma planilla no tiene que hacer que todo el catálogo aparezca como
 * "recién publicado". Y `on_hand` de una variante existente no se toca salvo
 * `resetStock` — el stock real lo maneja la operación del negocio, no una
 * planilla que puede tener semanas.
 *
 * Devuelve cuántas variantes escribió.
 */
export async function upsertCatalogProducts(
  items: readonly CatalogProductUpsert[],
  {
    resetStock = false,
    publishedAt = new Date(),
  }: { resetStock?: boolean; publishedAt?: Date } = {}
): Promise<number> {
  const db = getDb();
  let variantCount = 0;

  for (const product of items) {
    await db
      .insert(products)
      .values({
        saleMode: product.saleMode,
        showPrice: product.showPrice,
        slug: product.slug,
        name: product.name,
        description: product.description,
        categoryId: product.categoryId,
        brand: product.brand,
        ivaRate: product.ivaRate,
        isActive: true,
        publishedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          saleMode: product.saleMode,
          showPrice: product.showPrice,
          name: product.name,
          description: product.description,
          categoryId: product.categoryId,
          brand: product.brand,
          ivaRate: product.ivaRate,
          isActive: true,
        },
      });

    const productRow = (
      await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.slug, product.slug))
        .limit(1)
    )[0];
    if (!productRow)
      throw new Error(`No pude releer el producto ${product.slug}`);

    for (const [index, variant] of product.variants.entries()) {
      assertGs(variant.pricePyg, `${variant.sku}.price_pyg`);
      if (variant.compareAtPyg !== null) {
        assertGs(variant.compareAtPyg, `${variant.sku}.compare_at_pyg`);
      }

      await db
        .insert(variants)
        .values({
          productId: productRow.id,
          sku: variant.sku,
          label: variant.label,
          pricePyg: variant.pricePyg,
          compareAtPyg: variant.compareAtPyg,
          onHand: variant.onHand,
          position: index,
          isActive: true,
        })
        .onDuplicateKeyUpdate({
          set: {
            productId: productRow.id,
            label: variant.label,
            pricePyg: variant.pricePyg,
            compareAtPyg: variant.compareAtPyg,
            position: index,
            isActive: true,
            // El stock real lo maneja la operación del negocio: re-sembrar no
            // debería pisarlo salvo que se pida explícitamente.
            onHand: resetStock ? variant.onHand : sql`${variants.onHand}`,
          },
        });
      variantCount += 1;
    }
  }

  return variantCount;
}

/**
 * Siembra el catálogo (categorías, zonas de envío, productos y variantes).
 *
 * Exportada aparte de `main()` para que `scripts/demo.ts` pueda encadenarla
 * con la creación de pedidos de ejemplo sin levantar un segundo proceso ni
 * una segunda conexión a la base.
 */
export async function seedCatalog(
  resetStock: boolean = RESET_STOCK
): Promise<void> {
  const db = getDb();

  // --- Categorías ---------------------------------------------------------
  for (const category of SEED_CATEGORIES) {
    await db
      .insert(categories)
      .values({
        slug: category.slug,
        name: category.name,
        position: category.position,
      })
      .onDuplicateKeyUpdate({
        set: {
          name: category.name,
          position: category.position,
          isActive: true,
        },
      });
  }
  const categoryRows = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories);
  const categoryIdBySlug = new Map(
    categoryRows.map((row) => [row.slug, row.id])
  );
  console.log(`✓ ${SEED_CATEGORIES.length} categorías`);

  // --- Zonas de envío -----------------------------------------------------
  await upsertShippingZones(SEED_SHIPPING_ZONES);
  console.log(`✓ ${SEED_SHIPPING_ZONES.length} zonas de envío`);

  // --- Productos + variantes ---------------------------------------------
  const items: CatalogProductUpsert[] = SEED_PRODUCTS.map((product) => {
    const categoryId = categoryIdBySlug.get(product.categorySlug);
    if (!categoryId) {
      throw new Error(
        `Categoría inexistente: ${product.categorySlug} (producto ${product.slug})`
      );
    }
    return {
      slug: product.slug,
      name: product.name,
      description: product.description,
      categoryId,
      brand: product.brand,
      ivaRate: product.ivaRate,
      variants: product.variants.map((variant) => ({
        sku: variant.sku,
        label: variant.label,
        pricePyg: variant.pricePyg,
        compareAtPyg: variant.compareAtPyg ?? null,
        onHand: variant.onHand,
      })),
    };
  });

  const variantCount = await upsertCatalogProducts(items, {
    resetStock,
    // Fija, para que re-sembrar sea reproducible y no "recién publicado".
    publishedAt: new Date("2026-01-15T12:00:00Z"),
  });

  console.log(
    `✓ ${SEED_PRODUCTS.length} productos · ${variantCount} variantes`
  );
  console.log(
    resetStock
      ? "↺ stock reseteado a los valores del seed"
      : "· stock existente respetado (--reset-stock para pisarlo)"
  );
}

async function main(): Promise<void> {
  await seedCatalog();
  await closePool();
}

// `scripts/demo.ts` importa `seedCatalog` sin querer correr esto de nuevo —
// sólo se ejecuta cuando `seed.ts` es el script invocado directamente.
if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  main().catch(async (error) => {
    console.error(safeError(error).message);
    await closePool();
    process.exit(1);
  });
}
