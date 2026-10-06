import { and, asc, count, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  categories,
  productImages,
  products,
  stockAdjustments,
  variants,
} from "@/db/schema";

import type { AdminProductSort } from "@/lib/admin-product-sort";
import { EXPORT_MAX_ROWS } from "@/lib/csv";

import type { MessageKey, Params } from "@/i18n";

import { DomainError } from "./errors";
import type { Executor } from "./executor";
import { getAvailability, heldQtyMap } from "./stock";
import { notifyBackInStock } from "./stock-alerts";
import { log, mensajeDe } from "@/lib/log";

/**
 * Catálogo desde el panel (PLAN.md 4.6).
 *
 * A diferencia de `db/queries.ts`, que sólo ve lo publicado, acá se ven los
 * borradores y lo despublicado: es la vista del dueño, no la de la vidriera.
 */

export class AdminInputError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = "AdminInputError";
  }
}

export const PRODUCTS_PER_PAGE = 20;

export type AdminProductRow = {
  id: number;
  slug: string;
  name: string;
  brand: string | null;
  categoryName: string;
  /** Para elegir la ilustración placeholder cuando todavía no hay foto. */
  categorySlug: string;
  isActive: boolean;
  /** Si aparece en la fila de destacados de la home (`getFeaturedProducts`). */
  isFeatured: boolean;
  publishedAt: Date | null;
  variantCount: number;
  minPricePyg: number | null;
  onHand: number;
  /** La primera foto del producto, o `null` si no cargó ninguna. */
  imageCloudinaryId: string | null;
  imageAlt: string | null;
};

export type AdminProductFilters = {
  search?: string;
  categoryId?: number;
  /** `true` = sólo destacados. `undefined` = todos, que es el listado de siempre. */
  featured?: boolean;
  sort?: AdminProductSort;
  page?: number;
  perPage?: number;
};

export async function listAdminProducts(
  options: AdminProductFilters = {},
  executor?: Executor
): Promise<{
  rows: AdminProductRow[];
  total: number;
  page: number;
  totalPages: number;
}> {
  const tx = executor ?? getDb();
  const perPage = Math.min(
    100,
    Math.max(1, options.perPage ?? PRODUCTS_PER_PAGE)
  );
  const page = Math.max(1, options.page ?? 1);

  const where = productWhere(options);

  const [{ total = 0 } = {}] = await tx
    .select({ total: count() })
    .from(products)
    .where(where);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);

  // El stock y el precio del listado son agregados de las variantes, así que
  // ordenar por ellos es ordenar por el agregado y no por una columna.
  const onHandSum = sql`COALESCE(SUM(${variants.onHand}), 0)`;
  const minPrice = sql`MIN(${variants.pricePyg})`;
  const orderBy = {
    recientes: [desc(products.updatedAt)],
    // Un producto sin variantes suma cero y encabeza la lista: eso es correcto,
    // no se puede vender.
    stock: [asc(onHandSum), asc(products.name)],
    // Los sin precio (sin variantes) van al final en las dos direcciones: no
    // son "el más barato".
    "precio-asc": [sql`${minPrice} IS NULL`, asc(minPrice)],
    "precio-desc": [sql`${minPrice} IS NULL`, desc(minPrice)],
  }[options.sort ?? "recientes"];

  const rows = await tx
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      brand: products.brand,
      categoryName: categories.name,
      categorySlug: categories.slug,
      isActive: products.isActive,
      isFeatured: products.isFeatured,
      publishedAt: products.publishedAt,
      variantCount: sql<number>`COUNT(${variants.id})`,
      minPricePyg: sql<number | null>`MIN(${variants.pricePyg})`,
      onHand: sql<number>`COALESCE(SUM(${variants.onHand}), 0)`,
      // Subconsulta y no JOIN: un JOIN a `product_images` multiplica las filas
      // por sus fotos y rompe COUNT(variants) igual que rompería la
      // paginación. Las columnas van calificadas a mano — interpolar
      // `${productImages.productId}` acá adentro las emite sin el alias y la
      // correlación se compara consigo misma.
      imageCloudinaryId: sql<string | null>`(
        SELECT pi.\`cloudinary_id\` FROM \`product_images\` AS pi
        WHERE pi.\`product_id\` = \`products\`.\`id\`
        ORDER BY pi.\`position\` ASC, pi.\`id\` ASC LIMIT 1
      )`,
      imageAlt: sql<string | null>`(
        SELECT pi.\`alt\` FROM \`product_images\` AS pi
        WHERE pi.\`product_id\` = \`products\`.\`id\`
        ORDER BY pi.\`position\` ASC, pi.\`id\` ASC LIMIT 1
      )`,
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(variants, eq(variants.productId, products.id))
    .where(where)
    .groupBy(products.id, categories.name, categories.slug)
    .orderBy(...orderBy)
    .limit(perPage)
    .offset((safePage - 1) * perPage);

  return {
    rows: rows.map((row) => ({
      ...row,
      variantCount: Number(row.variantCount),
      minPricePyg: row.minPricePyg === null ? null : Number(row.minPricePyg),
      onHand: Number(row.onHand),
    })),
    total,
    page: safePage,
    totalPages,
  };
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** El filtro del listado, compartido con el export para que bajen lo mismo. */
function productWhere(options: AdminProductFilters) {
  const term = options.search?.trim();
  return and(
    term
      ? sql`(${products.name} LIKE ${`%${escapeLike(term)}%`} OR ${products.slug} LIKE ${`%${escapeLike(term)}%`})`
      : undefined,
    options.categoryId
      ? eq(products.categoryId, options.categoryId)
      : undefined,
    // `undefined` no filtra nada: el listado sin el filtro puesto sigue
    // trayendo destacados y no destacados por igual.
    options.featured === undefined
      ? undefined
      : eq(products.isFeatured, options.featured)
  );
}

export type ExportVariantRow = {
  saleMode: "stock" | "enquiry" | "showcase";
  showPrice: boolean;
  sku: string;
  productName: string;
  categoryName: string;
  label: string;
  pricePyg: number;
  onHand: number;
};

/**
 * El catálogo para el CSV: **una fila por variante**, no por producto.
 *
 * Es la unidad que tiene SKU, precio y stock — que es exactamente lo que se
 * va a hacer con este archivo (contar el depósito, mandarle la lista de
 * precios a alguien). Un CSV por producto obligaría a inventar "desde ₲X" y
 * a sumar stocks que después no se pueden contar contra la góndola.
 */
export async function listVariantsForExport(
  options: AdminProductFilters = {},
  limit = EXPORT_MAX_ROWS,
  executor?: Executor
): Promise<ExportVariantRow[]> {
  const tx = executor ?? getDb();

  return tx
    .select({
      sku: variants.sku,
      saleMode: products.saleMode,
      showPrice: products.showPrice,
      productName: products.name,
      categoryName: categories.name,
      label: variants.label,
      pricePyg: variants.pricePyg,
      onHand: variants.onHand,
    })
    .from(variants)
    .innerJoin(products, eq(variants.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(productWhere(options))
    .orderBy(asc(products.name), asc(variants.position), asc(variants.id))
    .limit(limit);
}

export async function getAdminProduct(productId: number, executor?: Executor) {
  const tx = executor ?? getDb();
  const rows = await tx
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  const product = rows[0];
  if (!product) return null;

  const productVariants = await tx
    .select()
    .from(variants)
    .where(eq(variants.productId, productId))
    .orderBy(asc(variants.position), asc(variants.id));

  const images = await tx
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.position));

  // La disponibilidad real es on_hand menos lo reservado: el dueño necesita
  // ver las dos cifras, porque "hay 3" y "puedo vender 1" son distintas.
  const held = await heldQtyMap(
    productVariants.map((variant) => variant.id),
    tx
  );

  return {
    product,
    images,
    variants: productVariants.map((variant) => ({
      ...variant,
      heldQty: held.get(variant.id) ?? 0,
      available: Math.max(0, variant.onHand - (held.get(variant.id) ?? 0)),
    })),
  };
}

export async function listCategories(executor?: Executor) {
  const tx = executor ?? getDb();
  return tx
    .select()
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.name));
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

export type ProductWrite = {
  saleMode?: "stock" | "enquiry" | "showcase";
  showPrice?: boolean;
  slug: string;
  name: string;
  description: string | null;
  categoryId: number;
  brand: string | null;
  ivaRate: number;
  isActive: boolean;
  /** `true` publica ahora; `false` lo saca de la vidriera. */
  published: boolean;
  /**
   * Destacado de la home, elegido a mano (O7). Ausente = no se toca, que es lo
   * que necesita todo formulario que no dibuje la casilla — S10 la agrega.
   */
  isFeatured?: boolean;
};

export async function createProduct(
  input: ProductWrite,
  executor?: Executor
): Promise<number> {
  const tx = executor ?? getDb();
  await assertSlugFree(tx, input.slug, null);

  await tx.insert(products).values({
    saleMode: input.saleMode,
    showPrice: (input.saleMode ?? "stock") === "stock" ? true : input.showPrice,
    slug: input.slug,
    name: input.name,
    description: input.description,
    categoryId: input.categoryId,
    brand: input.brand,
    ivaRate: input.ivaRate,
    isActive: input.isActive,
    isFeatured: input.isFeatured ?? false,
    publishedAt: input.published ? new Date() : null,
  });

  const rows = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.slug, input.slug))
    .limit(1);
  const created = rows[0];
  if (!created) throw new AdminInputError("adminError.producto.noPude");
  return created.id;
}

export async function updateProduct(
  productId: number,
  input: ProductWrite,
  executor?: Executor
): Promise<void> {
  const tx = executor ?? getDb();
  await assertSlugFree(tx, input.slug, productId);

  const existing = await tx
    .select({ publishedAt: products.publishedAt, saleMode: products.saleMode })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  const current = existing[0];
  if (!current) throw new AdminInputError("adminError.producto.noExiste");

  await tx
    .update(products)
    .set({
      saleMode: input.saleMode,
      showPrice:
        (input.saleMode ?? current.saleMode) === "stock"
          ? true
          : input.showPrice,
      slug: input.slug,
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      brand: input.brand,
      ivaRate: input.ivaRate,
      isActive: input.isActive,
      // `undefined` = no se toca. Es la diferencia importante con `false`: un
      // formulario que no dibuja la casilla de destacado (el de hoy, hasta
      // S10) no puede des-destacar un producto de paso al guardar el precio.
      ...(input.isFeatured === undefined
        ? {}
        : { isFeatured: input.isFeatured }),
      // Se conserva la fecha original de publicación: republicar no debería
      // mandar el producto al tope de "nuevos" otra vez.
      publishedAt: input.published ? (current.publishedAt ?? new Date()) : null,
    })
    .where(eq(products.id, productId));
}

async function assertSlugFree(
  tx: Executor,
  slug: string,
  exceptProductId: number | null
): Promise<void> {
  const rows = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.slug, slug))
    .limit(1);
  const clash = rows[0];
  if (clash && clash.id !== exceptProductId) {
    throw new AdminInputError("adminError.producto.slugRepetido", { slug });
  }
}

export type VariantWrite = {
  id?: number;
  sku: string;
  label: string;
  pricePyg: number;
  compareAtPyg: number | null;
  isActive: boolean;
  /**
   * A partir de cuántas unidades esta variante entra en "stock bajo" (O6).
   * `null` = usá el umbral global de la tienda (`DEFAULT_REORDER_POINT`), que
   * es lo que vale para toda variante que nadie configuró.
   */
  reorderPoint?: number | null;
};

/**
 * Alta/edición de variantes. **No toca `on_hand`**: el stock sólo se mueve por
 * `adjustStock()`, que exige motivo y deja auditoría. Si editar un precio
 * pudiera además cambiar el stock de paso, el registro de ajustes dejaría de
 * ser la historia completa del inventario.
 */
export async function saveVariant(
  productId: number,
  input: VariantWrite,
  executor?: Executor
): Promise<void> {
  const tx = executor ?? getDb();

  const clash = await tx
    .select({ id: variants.id })
    .from(variants)
    .where(eq(variants.sku, input.sku))
    .limit(1);
  const existing = clash[0];
  if (existing && existing.id !== input.id) {
    throw new AdminInputError("adminError.producto.skuRepetido", {
      sku: input.sku,
    });
  }

  if (input.id === undefined) {
    await tx.insert(variants).values({
      productId,
      sku: input.sku,
      label: input.label,
      pricePyg: input.pricePyg,
      compareAtPyg: input.compareAtPyg,
      isActive: input.isActive,
      reorderPoint: input.reorderPoint ?? null,
      onHand: 0,
    });
    return;
  }

  await tx
    .update(variants)
    .set({
      sku: input.sku,
      label: input.label,
      pricePyg: input.pricePyg,
      compareAtPyg: input.compareAtPyg,
      isActive: input.isActive,
      reorderPoint: input.reorderPoint ?? null,
    })
    .where(and(eq(variants.id, input.id), eq(variants.productId, productId)));
}

export type StockAdjustment = {
  variantId: number;
  /** Con signo: +10 repuse, −2 rotura. Nunca 0. */
  delta: number;
  reason: string;
  actor: string;
  /**
   * `users.id` de quien lo hizo (PR D). Opcional por el mismo motivo que en
   * `TransitionOptions`: hay caminos legítimos sin persona detrás.
   */
  actorUserId?: number | null;
};

export const ADJUSTMENT_MIN_REASON = 4;

/**
 * Ajuste manual de stock, auditado (PLAN.md 4.6).
 *
 * Se guarda el delta y no el total nuevo: dos ajustes simultáneos con
 * "poné 7" se pisan y uno de los dos conteos desaparece sin dejar rastro;
 * dos "sumá 3" se acumulan bien. El `FOR UPDATE` además serializa el ajuste
 * contra una venta que esté descontando al mismo tiempo.
 *
 * El motivo es obligatorio y va a `stock_adjustments` junto con el antes y el
 * después. Sin eso, un faltante de inventario es la palabra de uno contra la
 * de otro.
 */
export async function adjustStock(input: StockAdjustment): Promise<{
  previousOnHand: number;
  newOnHand: number;
}> {
  const disponibleAntes = await getAvailability(input.variantId).catch(() => 0);
  const resultado = await adjustStockInner(input);

  // "Avisame cuando haya stock" (O6): **después** del commit, sin `await` que
  // demore, y sólo cuando la disponibilidad cruzó de 0 a algo. Sin la
  // comparación, cada reposición de una variante que nunca estuvo agotada
  // haría una consulta al pedo; y con `await`, un Meta lento haría esperar al
  // dueño que acaba de contar cajas.
  if (resultado.newOnHand > resultado.previousOnHand && disponibleAntes <= 0) {
    void notifyBackInStock(input.variantId).catch((error) => {
      log.error("notifyBackInStock rechazó", { error: mensajeDe(error) });
    });
  }

  return resultado;
}

async function adjustStockInner(input: StockAdjustment): Promise<{
  previousOnHand: number;
  newOnHand: number;
}> {
  return getDb().transaction(async (tx) => applyStockAdjustment(tx, input));
}

/**
 * El corazón de `adjustStock`, **adentro de la transacción de quien llama**.
 *
 * Existe para que otro movimiento de inventario auditado —la devolución de
 * mercadería (`src/domain/returns.ts`)— escriba el mismo `stock_adjustments`
 * con las mismas reglas y en su propia transacción, sin copiar esto. No
 * dispara el aviso de "volvió el stock": eso va después del commit, y lo
 * hace quien llama (ver `adjustStock`).
 */
export async function applyStockAdjustment(
  tx: Executor,
  input: StockAdjustment
): Promise<{ previousOnHand: number; newOnHand: number }> {
  const reason = input.reason.trim();
  if (reason.length < ADJUSTMENT_MIN_REASON) {
    throw new AdminInputError("adminError.stock.sinMotivo");
  }
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new AdminInputError("adminError.stock.deltaCero");
  }

  const locked = await tx
    .select({ id: variants.id, onHand: variants.onHand })
    .from(variants)
    .where(eq(variants.id, input.variantId))
    .for("update");

  const variant = locked[0];
  if (!variant)
    throw new AdminInputError("adminError.producto.varianteNoExiste");

  // `on_hand` es UNSIGNED: restar de más haría wrap-around a un número
  // gigante en vez de fallar. Se corta acá.
  const newOnHand = variant.onHand + input.delta;
  if (newOnHand < 0) {
    throw new AdminInputError("adminError.stock.negativo", {
      cantidad: Math.abs(input.delta),
      stock: variant.onHand,
    });
  }

  await tx
    .update(variants)
    .set({ onHand: newOnHand })
    .where(eq(variants.id, variant.id));

  await tx.insert(stockAdjustments).values({
    variantId: variant.id,
    delta: input.delta,
    previousOnHand: variant.onHand,
    newOnHand,
    reason: reason.slice(0, 300),
    actor: input.actor,
    actorUserId: input.actorUserId ?? null,
  });

  return { previousOnHand: variant.onHand, newOnHand };
}

/** Historial de ajustes de una variante, para la ficha del producto. */
export async function listStockAdjustments(
  variantId: number,
  limit = 20,
  executor?: Executor
) {
  const tx = executor ?? getDb();
  return tx
    .select()
    .from(stockAdjustments)
    .where(eq(stockAdjustments.variantId, variantId))
    .orderBy(desc(stockAdjustments.createdAt), desc(stockAdjustments.id))
    .limit(limit);
}

export async function addProductImage(
  input: { productId: number; cloudinaryId: string; alt: string | null },
  executor?: Executor
): Promise<void> {
  const tx = executor ?? getDb();
  const [row] = await tx
    .select({ total: count() })
    .from(productImages)
    .where(eq(productImages.productId, input.productId));

  await tx.insert(productImages).values({
    productId: input.productId,
    cloudinaryId: input.cloudinaryId,
    alt: input.alt,
    position: row?.total ?? 0,
  });
}

export async function deleteProductImage(
  imageId: number,
  executor?: Executor
): Promise<void> {
  const tx = executor ?? getDb();
  await tx.delete(productImages).where(eq(productImages.id, imageId));
}

/**
 * Stock bajo, para el resumen (PLAN.md 4.7).
 *
 * Se mide sobre la disponibilidad (`on_hand − reservas vigentes`), no sobre
 * `on_hand`: si hay 5 y 5 están reservados, no hay nada para vender aunque el
 * número físico se vea sano.
 */
export const DEFAULT_REORDER_POINT = 3;

export type LowStockVariant = {
  variantId: number;
  sku: string;
  label: string;
  productName: string;
  available: number;
  /** El umbral que se le aplicó: el propio de la variante o el global. */
  reorderPoint: number;
};

/**
 * Las variantes que están en o por debajo de su punto de reposición.
 *
 * **El umbral es por variante** desde O6 (`variants.reorder_point`), con el
 * global de `threshold` como respaldo: una remera que se vende de a diez por
 * semana está en problemas con tres unidades, y una máquina que se vende una
 * vez por mes no lo está con una. Un único número para toda la tienda obliga
 * al dueño a elegir entre que le griten por todo o que no le avisen de nada.
 *
 * `COALESCE` en el SQL y no en JS: el umbral entra en el `ORDER BY` y en el
 * corte del `LIMIT`, así que tiene que decidirlo la base.
 */
export async function lowStockVariants(
  threshold = DEFAULT_REORDER_POINT,
  limit = 20,
  executor?: Executor
): Promise<LowStockVariant[]> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select({
      variantId: variants.id,
      sku: variants.sku,
      label: variants.label,
      onHand: variants.onHand,
      productName: products.name,
      reorderPoint: sql<number>`COALESCE(${variants.reorderPoint}, ${threshold})`,
    })
    .from(variants)
    .innerJoin(products, eq(variants.productId, products.id))
    .where(
      and(
        eq(variants.isActive, true),
        eq(products.isActive, true),
        eq(products.saleMode, "stock")
      )
    )
    // Por "cuánto le falta para su propio umbral", no por stock crudo: con
    // umbrales distintos, la variante con menos unidades no es la más urgente.
    //
    // Los dos `CAST(... AS SIGNED)` no son decorativos: `on_hand` y
    // `reorder_point` son **INT UNSIGNED**, y la resta se hace en aritmética
    // sin signo. MySQL 8 tira `ER_DATA_OUT_OF_RANGE` en cuanto `on_hand <
    // reorder_point` —que es exactamente el caso que esta consulta busca— y
    // MariaDB, peor, devuelve la vuelta al revés sin decir nada. Es el mismo
    // motivo del `GREATEST(..., 0)` de `consumeReservations`.
    .orderBy(
      asc(
        sql`CAST(${variants.onHand} AS SIGNED) - CAST(COALESCE(${variants.reorderPoint}, ${threshold}) AS SIGNED)`
      )
    )
    // Se traen de más porque el filtro real es sobre la disponibilidad, que se
    // calcula recién después de restar las reservas.
    .limit(limit * 5);

  const held = await heldQtyMap(
    rows.map((row) => row.variantId),
    tx
  );

  return rows
    .map((row) => ({
      variantId: row.variantId,
      sku: row.sku,
      label: row.label,
      productName: row.productName,
      available: Math.max(0, row.onHand - (held.get(row.variantId) ?? 0)),
      reorderPoint: Number(row.reorderPoint),
    }))
    .filter((row) => row.available <= row.reorderPoint)
    .sort(
      (a, b) => a.available - a.reorderPoint - (b.available - b.reorderPoint)
    )
    .slice(0, limit);
}
