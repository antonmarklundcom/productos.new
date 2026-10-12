/** Public projection hydrated inside SQLite, avoiding dependent network reads. */
const published = "p.is_active = 1 AND p.published_at IS NOT NULL AND c.is_active = 1";
const minPrice = "MIN(CASE WHEN p.show_price = 1 THEN v.price_pyg ELSE NULL END)";
const columns = `p.id, p.slug, p.name, p.description, p.brand, p.iva_rate AS ivaRate,
 p.sale_mode AS saleMode, p.show_price AS showPrice, c.name AS categoryName, c.slug AS categorySlug,
 p.published_at AS publishedAt, c.position AS categoryPosition`;
const joins = "FROM products p JOIN categories c ON c.id = p.category_id";
const projection = `SELECT s.*,
 (SELECT json_group_array(json_object(
   'id', v.id, 'sku', v.sku, 'label', v.label,
   'pricePyg', CASE WHEN s.showPrice = 1 THEN v.price_pyg ELSE 0 END,
   'compareAtPyg', CASE WHEN s.showPrice = 1 THEN v.compare_at_pyg ELSE NULL END,
   'available', MAX(0, v.on_hand - COALESCE((SELECT SUM(r.qty) FROM stock_reservations r
     WHERE r.variant_id = v.id AND r.state = 'held' AND r.expires_at > CURRENT_TIMESTAMP), 0))
 ) ORDER BY v.position, v.id) FROM variants v WHERE v.product_id = s.id AND v.is_active = 1) AS variantJson,
 (SELECT json_group_array(json_object('cloudinaryId', i.cloudinary_id, 'blurDataUrl', i.blur_data_url, 'alt', i.alt) ORDER BY i.position, i.id)
   FROM product_images i WHERE i.product_id = s.id) AS imageJson,
 (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = s.id AND r.status = 'approved') AS ratingCount,
 (SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = s.id AND r.status = 'approved') AS ratingAverage
 FROM selected s ORDER BY s.rn`;
function hydrate(row, detail = false) {
 const images = JSON.parse(row.imageJson || "[]");
 return {
  id: row.id, slug: row.slug, name: row.name, brand: row.brand, ivaRate: row.ivaRate,
  saleMode: row.saleMode, showPrice: Boolean(row.showPrice),
  categoryName: row.categoryName, categorySlug: row.categorySlug,
  variants: JSON.parse(row.variantJson || "[]"), image: images[0] ?? null,
  ...(row.ratingCount ? {rating: {count: row.ratingCount, average: row.ratingAverage}} : {}),
  ...(detail ? {description: row.description, images} : {}),
 };
}
export async function readBatch(db, statements) {
 const results = await db.batch(statements.map(({sql, args = []}) => {
   const statement = db.prepare(sql);
   return args.length ? statement.bind(...args) : statement;
 }));
 if (results.some(result => !result.success)) throw new Error("D1_PUBLIC_CATALOG_BATCH_FAILED");
 return results.map(result => result.results);
}
function projected(sql, args, order = "id ASC") {
 // Rank the bounded candidate set using its selected aliases. This avoids
 // repeating bound ranking parameters and guarantees the outer result order.
 return {sql: `WITH candidates AS (${sql}), selected AS (SELECT *, ROW_NUMBER() OVER (ORDER BY ${order}) AS rn FROM candidates) ${projection}`, args};
}
export async function catalogRead(db, options = {}) {
 if (options.productIds?.length === 0) return [];
 const conditions = [published], args = [];
 if (options.categorySlug) { conditions.push("c.slug = ?"); args.push(options.categorySlug); }
 if (options.featured) conditions.push("p.is_featured = 1");
 if (options.productIds) { conditions.push(`p.id IN (${options.productIds.map(() => "?").join(",")})`); args.push(...options.productIds); }
 args.push(options.limit ?? 100);
 const [rows] = await readBatch(db, [projected(`SELECT ${columns} ${joins} WHERE ${conditions.join(" AND ")}
  ORDER BY ${options.featured ? "p.published_at DESC, p.id ASC" : "c.position ASC, p.name ASC, p.id ASC"} LIMIT ?`, args, options.featured ? "publishedAt DESC, id ASC" : "categoryPosition ASC, name ASC, id ASC")]);
 return rows.map(row => hydrate(row));
}
export async function featuredRead(db, limit = 8) {
 const selection = `SELECT ${columns} ${joins} WHERE ${published}`;
 const [featured, fallback] = await readBatch(db, [
  projected(`${selection} AND p.is_featured = 1 ORDER BY p.published_at DESC, p.id ASC LIMIT ?`, [limit], "publishedAt DESC, id ASC"),
  projected(`${selection} AND NOT EXISTS (SELECT 1 ${joins} WHERE ${published} AND p.is_featured = 1)
    ORDER BY c.position ASC, p.name ASC, p.id ASC LIMIT ?`, [limit], "categoryPosition ASC, name ASC, id ASC"),
 ]);
 return (featured.length ? featured : fallback).map(row => hydrate(row));
}
export async function productRead(db, slug) {
 const [rows, reviews] = await readBatch(db, [
  projected(`SELECT ${columns} ${joins} WHERE ${published} AND p.slug = ? LIMIT 1`, [slug]),
  {sql: `SELECT r.id, r.rating, r.title, r.body, r.author_name AS authorName,
    r.created_at AS createdAt, r.owner_reply AS ownerReply, r.owner_reply_at AS ownerReplyAt
    FROM product_reviews r JOIN products p ON p.id = r.product_id JOIN categories c ON c.id = p.category_id
    WHERE ${published} AND p.slug = ? AND r.status = 'approved' ORDER BY r.created_at DESC, r.id DESC LIMIT 20`, args: [slug]},
 ]);
 return {product: rows[0] ? hydrate(rows[0], true) : null, reviews};
}
export async function categoryRead(db, query) {
 const page = Math.max(1, query.page ?? 1), perPage = Math.min(60, Math.max(1, query.perPage ?? 12));
 const args = [query.categorySlug], where = [published, "c.slug = ?"], having = [];
 if (query.brand) { where.push("p.brand = ?"); args.push(query.brand); }
 if (query.minPricePyg !== undefined) { having.push(`${minPrice} >= ?`); args.push(query.minPricePyg); }
 if (query.maxPricePyg !== undefined) { having.push(`${minPrice} <= ?`); args.push(query.maxPricePyg); }
 const from = `${joins} JOIN variants v ON v.product_id = p.id AND v.is_active = 1
   WHERE ${where.join(" AND ")} GROUP BY p.id${having.length ? " HAVING " + having.join(" AND ") : ""}`;
 const order = query.sort === "precio-asc" ? "minPrice IS NULL, minPrice ASC" :
   query.sort === "precio-desc" ? "minPrice IS NULL, minPrice DESC" :
   query.sort === "nuevos" ? "p.published_at DESC" : "p.name ASC";
 const rankedOrder = query.sort === "nuevos" ? "publishedAt DESC, id ASC" : order.replace("p.name", "name") + ", id ASC";
 const [rows, counted] = await readBatch(db, [
  projected(`SELECT ${columns}, ${minPrice} AS minPrice ${from} ORDER BY ${order}, p.id ASC LIMIT ? OFFSET ?`,
    [...args, perPage, (page - 1) * perPage], rankedOrder),
  {sql: `SELECT COUNT(*) AS total FROM (SELECT p.id ${from})`, args},
 ]);
 const total = counted[0].total;
 return {products: rows.map(row => hydrate(row)), total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage))};
}
export async function relatedRead(db, input, limit = 4) {
 // This Workers deployment is an enquiry catalogue with guarded order actions.
 // Keep held-stock and approved ratings; skip only co-purchase ranking.
 const args = [input.brand];
 let proximity = "CASE WHEN 1 THEN 0 END";
 if (input.pricePyg !== undefined) { proximity = `ABS(CAST(${minPrice} AS INTEGER) - ?)`; args.push(input.pricePyg); }
 args.push(input.categorySlug, input.productId, limit * 3);
 const [rows] = await readBatch(db, [projected(`SELECT ${columns}, ${minPrice} AS minPrice,
  CASE WHEN p.brand IS ? THEN 0 ELSE 1 END AS brandRank, ${proximity} AS priceDistance ${joins}
  JOIN variants v ON v.product_id = p.id AND v.is_active = 1 AND v.on_hand > 0
  WHERE ${published} AND c.slug = ? AND p.id != ? GROUP BY p.id
  ORDER BY brandRank, priceDistance, p.name ASC, p.id ASC LIMIT ?`, args, "brandRank, priceDistance, name ASC, id ASC")]);
 return rows.map(row => hydrate(row)).filter(product => product.variants.some(variant => variant.available > 0)).slice(0, limit);
}
export async function latestRead(db, slugs) {
 if (!slugs.length) return [];
 if (slugs.length > 60) throw new Error("D1_HOME_CATEGORY_LIMIT_INVALID");
 const [rows] = await readBatch(db, [projected(`SELECT ${columns} ${joins} WHERE ${published}
  AND c.slug IN (${slugs.map(() => "?").join(",")})
  AND p.id = (SELECT newer.id FROM products newer WHERE newer.category_id = c.id AND newer.is_active = 1
    AND newer.published_at IS NOT NULL AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id = newer.id AND v.is_active = 1)
    ORDER BY newer.published_at DESC, newer.id DESC LIMIT 1)`, slugs, "categoryPosition ASC, id ASC")]);
 const bySlug = new Map(rows.map(row => [row.categorySlug, hydrate(row)]));
 return slugs.flatMap(slug => bySlug.has(slug) ? [{products: [bySlug.get(slug)]}] : []).slice(0, 4);
}
