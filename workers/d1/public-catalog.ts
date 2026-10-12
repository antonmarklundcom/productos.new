import type { CatalogProduct, CatalogProductDetail, CategoryQuery, PagedProducts } from "../../src/db/queries";
import type { PublicReview, RatingSummary } from "../../src/domain/reviews";
import { getRelatedProducts as legacyRelatedProducts } from "../../src/db/queries";
import { catalogOnly } from "./catalog-capabilities";
import { CATEGORIAS_INICIALES } from "../../src/config/tienda";
import { getD1Bindings, getNativeDb } from "./database";
import { cachedPublicRead } from "./public-data-cache.mjs";
import { catalogRead, categoryRead, featuredRead, latestRead, productRead, readBatch, relatedRead } from "./public-catalog-sql.mjs";
export { isCatalogSort, CATALOG_SORTS } from "../../src/db/queries";

export function publicRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const context = getD1Bindings().PUBLIC_CATALOG;
  return cachedPublicRead(context, key, async () => {
    const started = Date.now();
    try { return await load(); }
    finally { context?.loads.push({reader: key.split(":")[0]!, durationMs: Date.now() - started}); }
  });
}
const binding = () => getNativeDb().$client;
type Category = {
  id: number; slug: string; name: string; parentId: number | null; position: number;
  isActive: boolean; description: string | null; imageCloudinaryId: string | null;
  imageAlt: string | null; createdAt: Date;
};
type CategoryData = { active: (Omit<Category, "createdAt"> & {createdAt: string})[]; configured: boolean };
const categoryData = () => publicRead("categories", async () => {
  const [active, count] = await readBatch(binding(), [
    {sql: `SELECT id, slug, name, parent_id AS parentId, position, is_active AS isActive,
      description, image_cloudinary_id AS imageCloudinaryId, image_alt AS imageAlt, created_at AS createdAt
      FROM categories WHERE is_active = 1 ORDER BY position`},
    {sql: "SELECT EXISTS(SELECT 1 FROM categories) AS configured"},
  ]);
  return {active, configured: Boolean(count[0]?.configured)};
});
const utc = (value: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z");
export async function getCategories(): Promise<Category[]> {
  const result = await categoryData() as CategoryData;
  return result.active.map(row => ({...row, isActive: Boolean(row.isActive), createdAt: utc(row.createdAt!)}));
}
export async function getCategoryBySlug(slug: string) {
  return (await getCategories()).find(category => category.slug === slug) ?? null;
}
export async function storeCategories() {
  try {
    const active = await getCategories();
    return active.length ? active : (await categoryData()).configured ? [] : CATEGORIAS_INICIALES;
  } catch { return CATEGORIAS_INICIALES; }
}
export async function getCatalog(options: {categorySlug?: string; limit?: number; featured?: boolean; productIds?: number[]} = {}): Promise<CatalogProduct[]> {
  return publicRead("catalog:" + JSON.stringify(options), () => catalogRead(binding(), options));
}
export async function getFeaturedProducts(limit = 8): Promise<CatalogProduct[]> {
  return publicRead("featured:" + limit, () => featuredRead(binding(), limit));
}
export async function getCategoryProducts(query: CategoryQuery): Promise<PagedProducts> {
  return publicRead("category:v1:" + JSON.stringify(query), () => categoryRead(binding(), query));
}
export async function getBrands(categorySlug: string): Promise<{brand: string; total: number}[]> {
  return publicRead("brands:" + categorySlug, async () => {
    const [rows] = await readBatch(binding(), [{sql: `SELECT p.brand, COUNT(p.id) AS total
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = 1 AND p.published_at IS NOT NULL AND c.is_active = 1 AND c.slug = ?
      AND p.brand IS NOT NULL AND p.brand != '' GROUP BY p.brand ORDER BY p.brand`, args: [categorySlug]}]);
    return rows;
  });
}
type ProductBundle = {product: CatalogProductDetail | null; reviews: (Omit<PublicReview, "createdAt" | "ownerReplyAt"> & {createdAt: string; ownerReplyAt: string | null})[]};
async function bundle(slug: string): Promise<ProductBundle> {
  return publicRead("product:v1:" + slug, async () => await productRead(binding(), slug) as ProductBundle);
}
// Request memo guarantees metadata/page/reviews share the same product batch.
export async function getProductBySlug(slug: string): Promise<CatalogProductDetail | null> {
  const result = await bundle(slug);
  const context = getD1Bindings().PUBLIC_CATALOG;
  if (context && result.product) context.productSlugs.set(result.product.id, slug);
  return result.product;
}
async function bundleById(id: number): Promise<ProductBundle | null> {
  const slug = getD1Bindings().PUBLIC_CATALOG?.productSlugs.get(id);
  if (slug) return bundle(slug);
  const [rows] = await readBatch(binding(), [{sql: "SELECT slug FROM products WHERE id = ?", args: [id]}]);
  return rows[0] ? bundle(rows[0].slug) : null;
}
export async function getProductRatingSummary(id: number): Promise<RatingSummary> {
  const result = await bundleById(id);
  return result?.product?.rating ?? {average: 0, count: 0};
}
export async function listApprovedReviews(id: number): Promise<PublicReview[]> {
  const result = await bundleById(id);
  return (result?.reviews ?? []).map(row => ({...row, createdAt: utc(row.createdAt), ownerReplyAt: row.ownerReplyAt ? utc(row.ownerReplyAt) : null}));
}
export async function getRelatedProducts(input: {productId: number; categorySlug: string; brand: string | null; pricePyg?: number}, limit = 4): Promise<CatalogProduct[]> {
  if (!catalogOnly) return legacyRelatedProducts(input, limit);
  return publicRead("related:v1:" + JSON.stringify([input, limit]), () => relatedRead(binding(), input, limit));
}
export async function getLatestCategoryProducts(slugs: string[]) {
  return publicRead("latest:" + JSON.stringify(slugs), () => latestRead(binding(), slugs));
}
