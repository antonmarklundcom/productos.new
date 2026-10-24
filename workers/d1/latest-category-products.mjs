/** Global chronological selection across all currently active categories. */
export async function latestCategoryProductIds(binding, _slugs = [], limit = 4) {
 void _slugs; // Retained call signature; selection is globally chronological.
 if (!Number.isInteger(limit) || limit < 1 || limit > 60) throw new Error("D1_HOME_CATEGORY_LIMIT_INVALID");
 const result = await binding.prepare(`SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id
  WHERE c.is_active = 1 AND p.is_active = 1 AND p.published_at IS NOT NULL
   AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.is_active = 1)
  ORDER BY p.published_at DESC, p.id DESC LIMIT ?`).bind(limit).all();
 return result.results.map(row => row.id);
}
