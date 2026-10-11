/** One published product per requested category, in the existing category order. */
export async function latestCategoryProductIds(binding, slugs, limit = 4) {
  if (!slugs.length) return [];
  if (slugs.length > 60 || !Number.isInteger(limit) || limit < 1 || limit > 60)
    throw new Error("D1_HOME_CATEGORY_LIMIT_INVALID");
  const requested = slugs.map((_, index) => `(?, ${index})`).join(",");
  const result = await binding.prepare(`
    WITH requested(slug, position) AS (VALUES ${requested}),
    picks AS MATERIALIZED (
      SELECT r.position, (
        SELECT p.id FROM products p
        WHERE p.category_id = c.id AND p.is_active = 1 AND p.published_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.is_active = 1)
        ORDER BY p.published_at DESC, p.id DESC LIMIT 1
      ) id
      FROM requested r JOIN categories c ON c.slug = r.slug WHERE c.is_active = 1
    )
    SELECT id FROM picks WHERE id IS NOT NULL ORDER BY position LIMIT ?
  `).bind(...slugs, limit).all();
  return result.results.map(row => row.id);
}
