import { slugify } from "../../src/lib/slug";

export type ImportCategory = { id: number; slug: string; name: string };

/** Slugs and normalized names are aliases, never last-row-wins identities. */
export function catalogCategoryAliases(rows: readonly ImportCategory[]) {
  const owners = new Map<string, Set<number>>();
  for (const row of rows) {
    for (const alias of [row.slug, slugify(row.name)]) {
      const ids = owners.get(alias) ?? new Set<number>();
      ids.add(row.id);
      owners.set(alias, ids);
    }
  }
  const ids = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const [alias, values] of owners) {
    if (values.size === 1) ids.set(alias, [...values][0]!);
    else ambiguous.add(alias);
  }
  return { ids, ambiguous };
}

export function resolveCatalogCategory(name: string, rows: readonly ImportCategory[]) {
  const alias = slugify(name);
  if (!alias) throw new Error("La categoría necesita un nombre válido.");
  const { ids, ambiguous } = catalogCategoryAliases(rows);
  if (ambiguous.has(alias)) throw new Error("La categoría «" + name + "» es ambigua; corregí sus nombres o slugs antes de importar.");
  const id = ids.get(alias);
  return id === undefined ? { slug: alias, id: undefined } : rows.find(row => row.id === id)!;
}
