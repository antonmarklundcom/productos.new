import type { Metadata } from "next";
import Link from "next/link";

import { CatalogImportForm } from "@/components/admin/catalog-import";
import { CsvDownloadButton } from "@/components/admin/csv-download";
import { ProductFilters } from "@/components/admin/product-filters";
import { ProductList } from "@/components/admin/product-list";
import { listAdminProducts, listCategories } from "@/domain/admin-products";
import { isAdminProductSort } from "@/lib/admin-product-sort";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { can } from "@/lib/permissions";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("panel.productos.meta") };

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  return single && single !== "" ? single : undefined;
}

export default async function AdminProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireCapabilityPage("productos");

  const query = await searchParams;
  const search = first(query.q);
  const rawCategory = Number(first(query.categoria));
  const categoryId = Number.isInteger(rawCategory) && rawCategory > 0 ? rawCategory : undefined;
  const rawSort = first(query.orden);
  const sort = isAdminProductSort(rawSort) ? rawSort : "recientes";
  const rawPage = Number(first(query.pagina) ?? 1);
  // == S17 == Filtro "sólo destacados". Ausente = todos, igual que hoy.
  const featured = first(query.destacados) === "1" ? true : undefined;

  const [result, categories] = await Promise.all([
    listAdminProducts({
      search,
      categoryId,
      featured,
      sort,
      page: Number.isFinite(rawPage) ? rawPage : 1,
    }),
    listCategories(),
  ]);

  const href = (page: number): string => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (categoryId) params.set("categoria", String(categoryId));
    if (sort !== "recientes") params.set("orden", sort);
    if (featured) params.set("destacados", "1");
    if (page > 1) params.set("pagina", String(page));
    const qs = params.toString();
    return qs === "" ? "/admin/productos" : `/admin/productos?${qs}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t("panel.productos.titulo")}</h1>
        <Link
          href="/admin/productos/nuevo"
          className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium"
        >
          {t("panel.productos.nuevo")}
        </Link>
      </div>

      <form className="mt-4 flex gap-2" action="/admin/productos">
        <input
          type="search"
          name="q"
          defaultValue={search ?? ""}
          placeholder={t("panel.productos.buscar.placeholder")}
          aria-label={t("panel.productos.buscar.label")}
          className="border-input bg-background h-9 flex-1 rounded-md border px-3 text-sm"
        />
        {/* La búsqueda es un form nativo: sin estos hidden, buscar dentro de
            una categoría la perdería y devolvería el catálogo entero. */}
        {categoryId ? <input type="hidden" name="categoria" value={String(categoryId)} /> : null}
        {sort !== "recientes" ? <input type="hidden" name="orden" value={sort} /> : null}
        {featured ? <input type="hidden" name="destacados" value="1" /> : null}
        <button type="submit" className="border-border rounded-lg border px-4 text-sm">
          {t("panel.filtros.buscar")}
        </button>
      </form>

      <ProductFilters
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
        }))}
        categoryId={categoryId}
        sort={sort}
        search={search}
        featured={featured ?? false}
      />

      {result.rows.length === 0 ? (
        <p className="text-muted-foreground border-border mt-6 rounded-xl border border-dashed p-8 text-center text-sm">
          {t("panel.productos.sinResultados")}
        </p>
      ) : (
        // Selección y acciones masivas (O7 §5.3 B): el listado en sí es
        // idéntico al de antes de este PR, movido a un componente cliente
        // porque la barra de acciones necesita saber qué filas están
        // tildadas — eso no se puede guardar del lado del servidor.
        <ProductList
          rows={result.rows.map((product) => ({
            id: product.id,
            slug: product.slug,
            name: product.name,
            categoryName: product.categoryName,
            categorySlug: product.categorySlug,
            variantCount: product.variantCount,
            minPricePyg: product.minPricePyg,
            onHand: product.onHand,
            isActive: product.isActive,
            publishedAt: product.publishedAt ? product.publishedAt.toISOString() : null,
            imageCloudinaryId: product.imageCloudinaryId,
            imageAlt: product.imageAlt,
            isFeatured: product.isFeatured,
          }))}
          categories={categories.map((category) => ({ id: category.id, name: category.name }))}
          canBulkPrice={can(actor.role, "precios.masivo")}
        />
      )}

      {result.totalPages > 1 ? (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label={t("nav.paginacion")}>
          {result.page > 1 ? (
            <Link
              href={href(result.page - 1)}
              className="border-border rounded-lg border px-3 py-2"
            >
              {t("panel.paginacion.anteriores")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground tabular-nums">
            {t("nav.pagina", { actual: result.page, total: result.totalPages })}
          </span>
          {result.page < result.totalPages ? (
            <Link
              href={href(result.page + 1)}
              className="border-border rounded-lg border px-3 py-2"
            >
              {t("panel.paginacion.siguientes")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      {/* Una fila por variante: es la unidad que tiene SKU, precio y stock, y
          es con lo que se cuenta el depósito. Sólo el dueño lo baja: es el
          catálogo con costos y existencias en un archivo portátil. */}
      {can(actor.role, "exports") ? (
        <div className="border-border mt-6 border-t pt-4">
          <CsvDownloadButton
            kind="productos"
            params={{
              q: search,
              categoria: categoryId ? String(categoryId) : undefined,
            }}
          />
          <p className="text-muted-foreground mt-1 text-xs">
            {t("panel.productos.csvAyuda")}
          </p>
        </div>
      ) : null}

      {/* Carga masiva: la misma acción que `pnpm importar:productos`, con
          ensayo primero. Owner y staff pueden dar de alta productos a mano
          (capacidad "productos"), así que también pueden hacerlo por planilla. */}
      {can(actor.role, "productos") ? (
        <div className="mt-6">
          <CatalogImportForm />
        </div>
      ) : null}
    </div>
  );
}
