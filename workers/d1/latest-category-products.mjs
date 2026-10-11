/** One published product per requested category, in the existing category order. */
export async function latestCategoryProductIds(binding, slugs, limit = 4) {
  if (!slugs.length) return [];
  if (slugs.length > 60 || !Number.isInteger(limit) || limit < 1 || limit > 60)
    throw new Error("D1_HOME_CATEGORY_LIMIT_INVALID");
  const requested = slugs.map((_, index) => `(?, ${index})`).join(",");
  const result = await binding.prepare(`
    WITH requested(slug, position) AS (VALUES ${requested}),
    ranked AS (
      SELECT p.id, r.position,
        ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY p.published_at DESC, p.id DESC) category_rank
      FROM products p JOIN categories c ON c.id = p.category_id
      JOIN requested r ON r.slug = c.slug
      WHERE p.is_active = 1 AND p.published_at IS NOT NULL AND c.is_active = 1
        AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.is_active = 1)
    )
    SELECT id FROM ranked WHERE category_rank = 1 ORDER BY position LIMIT ?
  `).bind(...slugs, limit).all();
  return result.results.map(row => row.id);
}
