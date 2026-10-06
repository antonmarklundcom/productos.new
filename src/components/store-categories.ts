import { getDb } from "@/db";
import { categories } from "@/db/schema";
import { getCategories } from "@/db/queries";
import { CATEGORIAS_INICIALES } from "@/config/tienda";

/** Initial landings are only a fallback for a store with no configured categories. */
export async function storeCategories() {
  try {
    const active = await getCategories();
    if (active.length) return active;
    const configured = await getDb()
      .select({ id: categories.id })
      .from(categories)
      .limit(1);
    return configured.length ? [] : CATEGORIAS_INICIALES;
  } catch {
    return CATEGORIAS_INICIALES;
  }
}
