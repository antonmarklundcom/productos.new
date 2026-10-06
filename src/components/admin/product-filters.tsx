"use client";

import { useRouter } from "next/navigation";

import {
  ADMIN_PRODUCT_SORTS,
  ADMIN_PRODUCT_SORT_LABEL,
  type AdminProductSort,
} from "@/lib/admin-product-sort";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

const TODAS = "";

type Category = { id: number; name: string };

/**
 * Categoría y orden del listado de productos.
 *
 * Navegan cambiando la URL, igual que los filtros de pedidos: el filtro
 * sobrevive al refresh, se puede compartir y el "atrás" del celular sigue
 * funcionando. El filtrado y el orden pasan en MySQL (ver
 * `domain/admin-products.ts`).
 *
 * Cambiar cualquiera de los dos vuelve a la página 1: quedarse en la 4 de un
 * listado que ahora tiene dos páginas es una pantalla vacía sin explicación.
 */
export function ProductFilters({
  categories,
  categoryId,
  sort,
  search,
  featured = false,
}: {
  categories: Category[];
  categoryId: number | undefined;
  sort: AdminProductSort;
  search: string | undefined;
  // == S17 == Filtro "sólo destacados" (`isFeatured`, O14).
  featured?: boolean;
}) {
  const router = useRouter();

  const go = (patch: { categoria?: string; orden?: string; destacados?: boolean }): void => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);

    const categoria = patch.categoria ?? (categoryId ? String(categoryId) : TODAS);
    if (categoria !== TODAS) params.set("categoria", categoria);

    const orden = patch.orden ?? sort;
    if (orden !== "recientes") params.set("orden", orden);

    const destacados = patch.destacados ?? featured;
    if (destacados) params.set("destacados", "1");

    const qs = params.toString();
    router.push(qs === "" ? "/admin/productos" : `/admin/productos?${qs}`);
  };

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <label className="sr-only" htmlFor="categoria">
        {t("panel.filtros.categoria")}
      </label>
      <select
        id="categoria"
        name="categoria"
        value={categoryId ? String(categoryId) : TODAS}
        onChange={(event) => go({ categoria: event.target.value })}
        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
      >
        <option value={TODAS}>{t("panel.filtros.todasCategorias")}</option>
        {categories.map((category) => (
          <option key={category.id} value={String(category.id)}>
            {category.name}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="orden">
        {t("panel.filtros.ordenar")}
      </label>
      <select
        id="orden"
        name="orden"
        value={sort}
        onChange={(event) => go({ orden: event.target.value })}
        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
      >
        {ADMIN_PRODUCT_SORTS.map((value) => (
          <option key={value} value={value}>
            {ADMIN_PRODUCT_SORT_LABEL[value]}
          </option>
        ))}
      </select>

      {/* == S17 == */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid={TESTIDS.adminProductFeaturedFilter}
          checked={featured}
          onChange={(event) => go({ destacados: event.target.checked })}
        />
        {t("panel.filtros.destacados")}
      </label>
    </div>
  );
}
