import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lte,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";

import { getDb } from "@/db";
import {
  categories,
  orderItems,
  orders,
  productImages,
  products,
  variants,
} from "@/db/schema";

import type { Executor } from "@/domain/executor";
import { getRatingSummaries, type RatingSummary } from "@/domain/reviews";
import { heldQtyMap } from "@/domain/stock";

export type CatalogVariant = {
  id: number;
  sku: string;
  label: string;
  pricePyg: number;
  compareAtPyg: number | null;
  available: number;
};

export type CatalogImage = {
  cloudinaryId: string;
  blurDataUrl: string | null;
  alt: string | null;
};

export type CatalogProduct = {
  saleMode?: "stock" | "enquiry" | "showcase";
  showPrice?: boolean;
  id: number;
  slug: string;
  name: string;
  brand: string | null;
  ivaRate: number;
  categoryName: string;
  categorySlug: string;
  image: CatalogImage | null;
  variants: CatalogVariant[];
  /**
   * Promedio y cantidad de reseñas **aprobadas**, sólo si tiene al menos una.
   * Opcional: quien arma un `CatalogProduct` a mano (tests, el feed) no tiene
   * por qué traerlo, y la tarjeta sin esto se dibuja como siempre.
   */
  rating?: RatingSummary;
};

export type CatalogProductDetail = CatalogProduct & {
  description: string | null;
  images: CatalogImage[];
};

/**
 * Qué se ve en la vidriera: producto activo, publicado y **en una categoría
 * activa**.
 *
 * Las tres condiciones, no dos. La de la categoría entró con el ABM del PR J,
 * cuando desactivar una categoría pasó a ser algo que el dueño hace desde el
 * navegador: hasta entonces el filtro miraba sólo el producto, y una categoría
 * apagada desaparecía del menú y devolvía 404 mientras sus productos seguían
 * en la home, en el buscador y en el sitemap — con una miga de pan que llevaba
 * derecho a esa página 404. Google indexando fichas huérfanas de una sección
 * que la tienda dio de baja es exactamente lo que no queremos.
 *
 * Toda consulta que use este filtro tiene que hacer `innerJoin(categories)`.
 * La única que no lo hacía era la del sitemap, y ahora lo hace.
 */
const PUBLISHED = () =>
  and(
    eq(products.isActive, true),
    isNotNull(products.publishedAt),
    eq(categories.isActive, true)
  );

export type CatalogSort =
  "relevancia" | "precio-asc" | "precio-desc" | "nuevos";

export const CATALOG_SORTS: CatalogSort[] = [
  "relevancia",
  "precio-asc",
  "precio-desc",
  "nuevos",
];

export function isCatalogSort(value: string | undefined): value is CatalogSort {
  return value !== undefined && (CATALOG_SORTS as string[]).includes(value);
}

/** Precio mínimo por producto — es el número por el que la gente ordena y filtra. */
const minPriceSql = sql<number>`MIN(CASE WHEN ${products.showPrice} THEN ${variants.pricePyg} ELSE NULL END)`;

type ProductRow = {
  saleMode: "stock" | "enquiry" | "showcase";
  showPrice: boolean;
  id: number;
  slug: string;
  name: string;
  description: string | null;
  brand: string | null;
  ivaRate: number;
  categoryName: string;
  categorySlug: string;
};

/**
 * Completa cada producto con su imagen principal, sus variantes, la
 * disponibilidad en vivo y el resumen de reseñas aprobadas. Cuatro queries
 * acotadas por ids (la de reseñas, agrupada), no N+1.
 */
async function hydrate(
  tx: Executor,
  rows: ProductRow[]
): Promise<CatalogProduct[]> {
  if (rows.length === 0) return [];
  const productIds = rows.map((row) => row.id);

  const variantRows = await tx
    .select({
      id: variants.id,
      productId: variants.productId,
      sku: variants.sku,
      label: variants.label,
      pricePyg: variants.pricePyg,
      compareAtPyg: variants.compareAtPyg,
      onHand: variants.onHand,
    })
    .from(variants)
    .where(
      and(eq(variants.isActive, true), inArray(variants.productId, productIds))
    )
    .orderBy(asc(variants.productId), asc(variants.position));

  const imageRows = await tx
    .select({
      productId: productImages.productId,
      cloudinaryId: productImages.cloudinaryId,
      blurDataUrl: productImages.blurDataUrl,
      alt: productImages.alt,
      position: productImages.position,
    })
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(asc(productImages.productId), asc(productImages.position));

  const held = await heldQtyMap(
    variantRows.map((row) => row.id),
    tx
  );

  const ratings = await getRatingSummaries(productIds, tx);

  const variantsByProduct = new Map<number, CatalogVariant[]>();
  for (const row of variantRows) {
    const list = variantsByProduct.get(row.productId) ?? [];
    list.push({
      id: row.id,
      sku: row.sku,
      label: row.label,
      pricePyg: row.pricePyg,
      compareAtPyg: row.compareAtPyg,
      available: Math.max(0, row.onHand - (held.get(row.id) ?? 0)),
    });
    variantsByProduct.set(row.productId, list);
  }

  const imagesByProduct = new Map<number, CatalogImage[]>();
  for (const row of imageRows) {
    const list = imagesByProduct.get(row.productId) ?? [];
    list.push({
      cloudinaryId: row.cloudinaryId,
      blurDataUrl: row.blurDataUrl,
      alt: row.alt,
    });
    imagesByProduct.set(row.productId, list);
  }

  return rows.map((row) => ({
    saleMode: row.saleMode,
    showPrice: row.showPrice,
    id: row.id,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    ivaRate: row.ivaRate,
    categoryName: row.categoryName,
    categorySlug: row.categorySlug,
    image: imagesByProduct.get(row.id)?.[0] ?? null,
    variants: (variantsByProduct.get(row.id) ?? []).map((variant) =>
      row.showPrice ? variant : { ...variant, pricePyg: 0, compareAtPyg: null }
    ),
    ...(ratings.has(row.id) ? { rating: ratings.get(row.id) } : {}),
  }));
}

const PRODUCT_COLUMNS = {
  saleMode: products.saleMode,
  showPrice: products.showPrice,
  id: products.id,
  slug: products.slug,
  name: products.name,
  description: products.description,
  brand: products.brand,
  ivaRate: products.ivaRate,
  categoryName: categories.name,
  categorySlug: categories.slug,
} as const;

/** Catálogo completo (home / demo). */
export async function getCatalog(
  options: { categorySlug?: string; limit?: number; featured?: boolean } = {},
  executor?: Executor
): Promise<CatalogProduct[]> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select(PRODUCT_COLUMNS)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        PUBLISHED(),
        options.categorySlug
          ? eq(categories.slug, options.categorySlug)
          : undefined,
        options.featured ? eq(products.isFeatured, true) : undefined
      )
    )
    // Los destacados se ordenan por fecha de publicación, no por categoría y
    // nombre: en una vitrina de ocho productos elegidos a mano, el orden
    // alfabético no significa nada y lo nuevo sí.
    .orderBy(
      ...(options.featured
        ? [desc(products.publishedAt)]
        : [asc(categories.position), asc(products.name)])
    )
    .limit(options.limit ?? 100);

  return hydrate(tx, rows);
}

/**
 * Los productos de la vitrina de la home (O7, plan-operacion §5.3 E).
 *
 * **Sin ningún destacado marcado devuelve exactamente lo que la home muestra
 * hoy**: `getCatalog({ limit })`, con su orden por posición de categoría y
 * nombre. Eso no es un fallback de cortesía — es lo que permite que la
 * migración `0012` llegue a una tienda existente sin cambiarle la portada. La
 * feature se enciende sola el día que el dueño marca el primer producto, y
 * hasta entonces no existe.
 *
 * (El plan §5.3 E dice "los más nuevos" y lo iguala a la home de hoy; son dos
 * cosas distintas: la home de hoy ordena por categoría y nombre. Manda el
 * criterio verificable —"lo que la home muestra hoy"— porque es el que hace
 * que una tienda que sincroniza esta migración no vea moverse su portada.)
 */
export async function getFeaturedProducts(
  limit = 8,
  executor?: Executor
): Promise<CatalogProduct[]> {
  const destacados = await getCatalog({ featured: true, limit }, executor);
  if (destacados.length > 0) return destacados;

  return getCatalog({ limit }, executor);
}

export type CategoryQuery = {
  categorySlug: string;
  brand?: string;
  minPricePyg?: number;
  maxPricePyg?: number;
  sort?: CatalogSort;
  page?: number;
  perPage?: number;
};

export type PagedProducts = {
  products: CatalogProduct[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

/**
 * Listado de categoría con filtros, orden y paginación — todo server-side.
 * Se agrupa por producto para poder filtrar y ordenar por el precio mínimo
 * de sus variantes sin traer el catálogo entero a memoria.
 */
export async function getCategoryProducts(
  query: CategoryQuery,
  executor?: Executor
): Promise<PagedProducts> {
  const tx = executor ?? getDb();
  const page = Math.max(1, query.page ?? 1);
  const perPage = Math.min(60, Math.max(1, query.perPage ?? 12));

  const filters = and(
    PUBLISHED(),
    eq(categories.slug, query.categorySlug),
    query.brand ? eq(products.brand, query.brand) : undefined
  );

  const havingParts = [
    query.minPricePyg !== undefined
      ? gte(minPriceSql, query.minPricePyg)
      : undefined,
    query.maxPricePyg !== undefined
      ? lte(minPriceSql, query.maxPricePyg)
      : undefined,
  ].filter(Boolean);
  const having = havingParts.length > 0 ? and(...havingParts) : undefined;

  const orderBy = (() => {
    switch (query.sort) {
      case "precio-asc":
        return asc(minPriceSql);
      case "precio-desc":
        return desc(minPriceSql);
      case "nuevos":
        return desc(products.publishedAt);
      default:
        return asc(products.name);
    }
  })();

  const grouped = tx
    .select({ ...PRODUCT_COLUMNS, minPrice: minPriceSql })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .innerJoin(
      variants,
      and(eq(variants.productId, products.id), eq(variants.isActive, true))
    )
    .where(filters)
    .groupBy(products.id, categories.name, categories.slug);

  const rows = await (having ? grouped.having(having) : grouped)
    .orderBy(
      ...(query.sort?.startsWith("precio-")
        ? [sql`${minPriceSql} IS NULL`]
        : []),
      orderBy
    )
    .limit(perPage)
    .offset((page - 1) * perPage);

  const counted = tx
    .select({ id: products.id })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .innerJoin(
      variants,
      and(eq(variants.productId, products.id), eq(variants.isActive, true))
    )
    .where(filters)
    .groupBy(products.id);
  const total = (await (having ? counted.having(having) : counted)).length;

  return {
    products: await hydrate(tx, rows),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function getProductBySlug(
  slug: string,
  executor?: Executor
): Promise<CatalogProductDetail | null> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select(PRODUCT_COLUMNS)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(PUBLISHED(), eq(products.slug, slug)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const [hydrated] = await hydrate(tx, [row]);
  if (!hydrated) return null;

  const images = await tx
    .select({
      cloudinaryId: productImages.cloudinaryId,
      blurDataUrl: productImages.blurDataUrl,
      alt: productImages.alt,
    })
    .from(productImages)
    .where(eq(productImages.productId, row.id))
    .orderBy(asc(productImages.position));

  return { ...hydrated, description: row.description, images };
}

/**
 * Búsqueda con el índice FULLTEXT de `products`.
 *
 * En modo booleano con `*` para que "auricu" encuentre "auriculares", con
 * fallback a LIKE: los términos de menos de 4 caracteres caen bajo
 * `ft_min_word_len` y FULLTEXT los ignora, cosa que en un catálogo con
 * "gorra" o "jean" se nota enseguida.
 */
export async function searchProducts(
  term: string,
  options: { limit?: number } = {},
  executor?: Executor
): Promise<CatalogProduct[]> {
  const tx = executor ?? getDb();
  const cleaned = term
    .trim()
    .replace(/[+\-><()~*"@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2) return [];

  const limit = options.limit ?? 40;
  const booleanTerm = cleaned
    .split(" ")
    .map((word) => `${word}*`)
    .join(" ");

  const matched = await tx
    .select(PRODUCT_COLUMNS)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        PUBLISHED(),
        sql`MATCH(${products.name}, ${products.description}) AGAINST (${booleanTerm} IN BOOLEAN MODE)`
      )
    )
    .limit(limit);

  if (matched.length > 0) return hydrate(tx, matched);

  const like = `%${cleaned}%`;
  const fallback = await tx
    .select(PRODUCT_COLUMNS)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        PUBLISHED(),
        sql`(${products.name} LIKE ${like} OR ${products.brand} LIKE ${like})`
      )
    )
    .limit(limit);

  return hydrate(tx, fallback);
}

export type SearchSuggestion = {
  slug: string;
  name: string;
  brand: string | null;
};

/**
 * Sugerencias para el buscador mientras se escribe (FASE 2, PR N).
 *
 * Es `searchProducts` sin `hydrate()`: nombre, marca y slug, nada más. La
 * diferencia importa porque esto se dispara con cada tecla (con debounce, pero
 * igual): `hydrate` trae variantes, fotos y **calcula las reservas de stock**
 * de cada producto, y nada de eso se dibuja en una lista de sugerencias.
 *
 * Mismo filtro `PUBLISHED()` y la misma degradación a LIKE que la búsqueda de
 * verdad: una sugerencia que lleva a un resultado vacío es peor que ninguna.
 */
export async function suggestProducts(
  term: string,
  limit = 6,
  executor?: Executor
): Promise<SearchSuggestion[]> {
  const tx = executor ?? getDb();
  const cleaned = term
    .trim()
    .replace(/[+\-><()~*"@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2) return [];

  const columns = {
    slug: products.slug,
    name: products.name,
    brand: products.brand,
  };
  const booleanTerm = cleaned
    .split(" ")
    .map((word) => `${word}*`)
    .join(" ");

  const matched = await tx
    .select(columns)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        PUBLISHED(),
        sql`MATCH(${products.name}, ${products.description}) AGAINST (${booleanTerm} IN BOOLEAN MODE)`
      )
    )
    .limit(limit);

  if (matched.length > 0) return matched;

  const like = `%${cleaned}%`;
  return tx
    .select(columns)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        PUBLISHED(),
        sql`(${products.name} LIKE ${like} OR ${products.brand} LIKE ${like})`
      )
    )
    .limit(limit);
}

export async function getCategories(executor?: Executor) {
  const tx = executor ?? getDb();
  return tx
    .select()
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.position));
}

export async function getCategoryBySlug(slug: string, executor?: Executor) {
  const tx = executor ?? getDb();
  const rows = await tx
    .select()
    .from(categories)
    .where(and(eq(categories.isActive, true), eq(categories.slug, slug)))
    .limit(1);
  return rows[0] ?? null;
}

export type BrandFacet = { brand: string; total: number };

/**
 * Marcas presentes en una categoría, **con cuántos productos tiene cada una**.
 *
 * El número no es decoración: "Marca X (12)" y "Marca Y (1)" le dicen a la
 * compradora cuál filtro vale la pena antes de gastar un toque en él. Sin el
 * conteo, elegir una marca es una apuesta, y la respuesta más común de una
 * apuesta así es una grilla con un solo producto y un viaje de vuelta.
 *
 * Cuenta productos y no variantes: lo que se va a listar son fichas.
 */
export async function getBrands(
  categorySlug: string,
  executor?: Executor
): Promise<BrandFacet[]> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select({ brand: products.brand, total: count(products.id) })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        PUBLISHED(),
        eq(categories.slug, categorySlug),
        isNotNull(products.brand)
      )
    )
    .groupBy(products.brand)
    .orderBy(asc(products.brand));

  return rows
    .filter((row): row is { brand: string; total: number } =>
      Boolean(row.brand)
    )
    .map((row) => ({ brand: row.brand, total: Number(row.total) }));
}

/**
 * Los estados en los que un pedido "cuenta" para comprado-junto: desde que se
 * confirma la plata en adelante. `pendiente_pago`, `esperando_verificacion`,
 * `rechazado`, `vencido` y `cancelado` no prueban que dos productos se
 * compren juntos — sólo que alguien los puso en el mismo carrito y no llegó
 * a pagar (o pagó y se le devolvió, `reembolsado`, que tampoco cuenta como
 * venta).
 */
const CO_PURCHASE_STATUSES = [
  "pagado",
  "preparando",
  "enviado",
  "entregado",
] as const;

const CO_PURCHASE_MAX_ORDERS = 500;

/**
 * Paso 1 de `getRelatedProducts`: lo que se compró junto con `productId`, en
 * cualquier categoría.
 *
 * Dos consultas y no una con subquery correlacionada: la primera trae los
 * pedidos (ya filtrados por estado) que tienen a `productId` adentro, y la
 * segunda cuenta, para cada otro producto, en cuántos de esos pedidos
 * también aparece. Separarlas es más fácil de leer y evita repetir el join a
 * `orders` dos veces en la misma consulta.
 *
 * Mismo filtro de publicado/stock que el resto de la vidriera —un producto
 * que se compró junto pero ya no se vende no sirve de sugerencia— y el mismo
 * criterio de `limit * 3` candidatos que la búsqueda por categoría: el
 * segundo filtro de stock (holds ajenos) se hace después con `hydrate`.
 */
async function getCoPurchasedProducts(
  tx: Executor,
  productId: number,
  limit: number
): Promise<CatalogProduct[]> {
  const coOrders = await tx
    .selectDistinct({ orderId: orderItems.orderId })
    .from(orderItems)
    .innerJoin(variants, eq(variants.id, orderItems.variantId))
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(variants.productId, productId),
        inArray(orders.status, CO_PURCHASE_STATUSES)
      )
    )
    // Tope: un producto con miles de ventas no puede convertir la segunda
    // consulta en un `IN (...)` de miles de ids en cada render de la ficha.
    // Los 500 pedidos más nuevos alcanzan para rankear, y siguen la moda.
    .orderBy(desc(orderItems.orderId))
    .limit(CO_PURCHASE_MAX_ORDERS);

  if (coOrders.length === 0) return [];
  const coOrderIds = coOrders.map((row) => row.orderId);

  const coPurchasedOrders = count(sql`DISTINCT ${orderItems.orderId}`);

  const rows = await tx
    .select({ ...PRODUCT_COLUMNS, coPurchasedOrders })
    .from(orderItems)
    .innerJoin(
      variants,
      and(
        eq(variants.id, orderItems.variantId),
        eq(variants.isActive, true),
        gt(variants.onHand, 0)
      )
    )
    .innerJoin(products, eq(products.id, variants.productId))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        inArray(orderItems.orderId, coOrderIds),
        ne(products.id, productId),
        PUBLISHED()
      )
    )
    .groupBy(products.id, categories.name, categories.slug)
    .orderBy(desc(coPurchasedOrders), asc(products.name))
    .limit(limit * 3);

  const hydrated = await hydrate(tx, rows);

  return hydrated
    .filter((product) =>
      product.variants.some((variant) => variant.available > 0)
    )
    .slice(0, limit);
}

/**
 * Paso 2 de `getRelatedProducts`, el de siempre: misma categoría, publicados,
 * con stock, sin el que se está mirando **y sin lo que ya salió en el paso
 * 1** (`excludeIds`). El orden mezcla dos señales, en este orden:
 *
 * 1. **La misma marca primero.** Quien está mirando una Marca X suele estar
 *    decidiendo entre Marca X, no entre categorías.
 * 2. **El precio más parecido después.** Es la señal de relevancia más
 *    honesta que hay en una góndola: a quien mira algo de ₲80.000 no le sirve
 *    que le ofrezcan uno de ₲2.000.000, aunque sea de la misma categoría.
 *
 * El filtro de stock se hace en dos pasos y a propósito. En SQL se pide
 * `on_hand > 0`, que es barato y descarta la mayoría; después, con las
 * reservas ya calculadas por `hydrate`, se descartan los que quedaron en cero
 * por holds ajenos. Meter las reservas adentro de esta consulta sería
 * repetir `heldQtyMap` en SQL para ahorrarse unas filas.
 *
 * Por eso se piden `limit * 3` candidatos: los que se caen en el segundo paso
 * no dejan huecos. Puede devolver menos de `limit`, y la ficha simplemente no
 * dibuja la sección si vuelve vacío.
 */
async function getSameCategoryRelated(
  tx: Executor,
  input: {
    productId: number;
    categorySlug: string;
    brand: string | null;
    pricePyg?: number;
  },
  limit: number,
  excludeIds: number[]
): Promise<CatalogProduct[]> {
  // `<=>` es el igual de MySQL que trata NULL como un valor: con `=`, un
  // producto sin marca comparado contra NULL da NULL (o sea, ni verdadero ni
  // falso) y el CASE se cae siempre al 1. Con `<=>`, "los dos sin marca"
  // cuenta como misma marca, que es lo que uno quiere en un catálogo donde la
  // marca es opcional.
  const mismaMarca = sql`CASE WHEN ${products.brand} <=> ${input.brand} THEN 0 ELSE 1 END`;
  /*
    El CAST a SIGNED no es adorno: `price_pyg` es BIGINT UNSIGNED, y en MySQL
    (y en MariaDB) restarle a un unsigned algo más grande no da un negativo, da
    ER_DATA_OUT_OF_RANGE y **la consulta entera falla**. O sea: cualquier ficha
    de producto que tuviera en su categoría algo más barato que él se caía con
    error 500, que es casi cualquier ficha de un catálogo real.
  */
  const cercaniaDePrecio =
    input.pricePyg === undefined
      ? sql`0`
      : sql`ABS(CAST(${minPriceSql} AS SIGNED) - ${input.pricePyg})`;

  const rows = await tx
    .select({ ...PRODUCT_COLUMNS, minPrice: minPriceSql })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .innerJoin(
      variants,
      and(eq(variants.productId, products.id), eq(variants.isActive, true))
    )
    .where(
      and(
        PUBLISHED(),
        eq(categories.slug, input.categorySlug),
        ne(products.id, input.productId),
        excludeIds.length > 0 ? notInArray(products.id, excludeIds) : undefined,
        gt(variants.onHand, 0)
      )
    )
    .groupBy(products.id, categories.name, categories.slug)
    .orderBy(mismaMarca, cercaniaDePrecio, asc(products.name))
    .limit(limit * 3);

  const hydrated = await hydrate(tx, rows);

  return hydrated
    .filter((product) =>
      product.variants.some((variant) => variant.available > 0)
    )
    .slice(0, limit);
}

/**
 * "También te puede interesar" para la ficha de producto (FASE 2, PR M; el
 * primer paso de "comprado junto" es posterior).
 *
 * Primero lo que la gente compró de verdad junto con este producto —de
 * cualquier categoría, ver `getCoPurchasedProducts`—, y recién con los
 * lugares que sobren, lo de la misma categoría (`getSameCategoryRelated`),
 * sin repetir nada que ya haya salido en el primer paso. Quien compró un
 * cargador junto con este celular es una señal más fuerte que "otro celular
 * de la misma marca y precio parecido", y sólo cuando no hay suficientes
 * compras juntas la sección cae al criterio de siempre.
 */
export async function getRelatedProducts(
  input: {
    productId: number;
    categorySlug: string;
    brand: string | null;
    pricePyg?: number;
  },
  limit = 4,
  executor?: Executor
): Promise<CatalogProduct[]> {
  const tx = executor ?? getDb();

  const coPurchased = await getCoPurchasedProducts(tx, input.productId, limit);
  const remaining = limit - coPurchased.length;
  if (remaining <= 0) return coPurchased.slice(0, limit);

  const sameCategory = await getSameCategoryRelated(
    tx,
    input,
    remaining,
    coPurchased.map((product) => product.id)
  );

  return [...coPurchased, ...sameCategory];
}

/**
 * Productos publicados a partir de una lista de slugs — lo que resuelve
 * `/favoritos` (guardados en el navegador, `src/lib/wishlist-store.ts`) y una
 * lista compartida por `?p=`. Mismo `PRODUCT_COLUMNS`/`PUBLISHED()` que el
 * resto del catálogo: un producto despublicado o de una categoría apagada
 * desaparece de los favoritos de quien lo guardó, igual que desaparecería de
 * cualquier otra vidriera.
 *
 * Devuelve en el **mismo orden** que `slugs` (más nuevo primero en la lista
 * de favoritos) — `inArray` no lo garantiza, así que se reordena a mano.
 */
export async function getProductsBySlugs(
  slugs: string[],
  executor?: Executor
): Promise<CatalogProduct[]> {
  if (slugs.length === 0) return [];
  const tx = executor ?? getDb();

  const rows = await tx
    .select(PRODUCT_COLUMNS)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(PUBLISHED(), inArray(products.slug, slugs)));

  const hydrated = await hydrate(tx, rows);
  const bySlug = new Map(hydrated.map((product) => [product.slug, product]));
  return slugs
    .map((slug) => bySlug.get(slug))
    .filter((product): product is CatalogProduct => product !== undefined);
}

/**
 * Lo publicable en el sitemap: categorías activas y productos publicados.
 *
 * Una sola consulta por tabla y sólo las columnas que el XML usa — el sitemap
 * no necesita variantes, ni fotos, ni disponibilidad, y traerlas sería pagar
 * el `hydrate()` entero para tirarlo. El filtro es el mismo `PUBLISHED()` de
 * la vidriera: lo que no se ve, no se indexa.
 */
export async function getSitemapEntries(executor?: Executor): Promise<{
  categories: { slug: string }[];
  products: { slug: string; updatedAt: Date | null }[];
}> {
  const tx = executor ?? getDb();

  const [categoryRows, productRows] = await Promise.all([
    tx
      .select({ slug: categories.slug })
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.position)),
    tx
      .select({ slug: products.slug, updatedAt: products.updatedAt })
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(PUBLISHED())
      .orderBy(asc(products.slug)),
  ]);

  return { categories: categoryRows, products: productRows };
}

/**
 * El catálogo entero para el feed de productos (`/feed.xml`): lo publicado,
 * con variantes, disponibilidad en vivo y **todas** las fotos. Mismo
 * `PUBLISHED()` que la vidriera: lo que no se ve, no se anuncia.
 */
export async function getFeedProducts(
  executor?: Executor
): Promise<CatalogProductDetail[]> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select(PRODUCT_COLUMNS)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        PUBLISHED(),
        eq(products.saleMode, "stock"),
        eq(products.showPrice, true)
      )
    )
    .orderBy(asc(products.slug));
  if (rows.length === 0) return [];

  const hydrated = await hydrate(tx, rows);
  const imageRows = await tx
    .select({
      productId: productImages.productId,
      cloudinaryId: productImages.cloudinaryId,
      blurDataUrl: productImages.blurDataUrl,
      alt: productImages.alt,
    })
    .from(productImages)
    .where(
      inArray(
        productImages.productId,
        rows.map((row) => row.id)
      )
    )
    .orderBy(asc(productImages.productId), asc(productImages.position));

  const imagesByProduct = new Map<number, CatalogImage[]>();
  for (const { productId, ...image } of imageRows) {
    const list = imagesByProduct.get(productId) ?? [];
    list.push(image);
    imagesByProduct.set(productId, list);
  }
  const descriptions = new Map(rows.map((row) => [row.id, row.description]));

  return hydrated.map((product) => ({
    ...product,
    description: descriptions.get(product.id) ?? null,
    images: imagesByProduct.get(product.id) ?? [],
  }));
}
