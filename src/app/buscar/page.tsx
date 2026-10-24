import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { CatalogFilters } from "@/components/catalog-filters";
import { Suspense } from "react";
import { parseBudget } from "@/lib/price-ranges";
import { getCategories, getSearchFacets, isCatalogSort, searchProductsPage } from "@/db/queries";
import { getStoreSettings } from "@/domain/store-settings";
import { t, tPlural } from "@/i18n";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("buscar.meta"),
  robots: { index: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const query = await searchParams;
  const raw = Array.isArray(query.q) ? query.q[0] : query.q;
  const term = (raw ?? "").trim();

  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const budget = parseBudget(first(query.min), first(query.max), first(query.precio));
  const sort = first(query.orden);
  const facets = term.length >= 2 ? await getSearchFacets(term).catch(() => ({brands:[],categories:[]})) : {brands:[],categories:[]};
  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key,value] of Object.entries(query)) {const single=first(value); if (single && key !== "page") next.set(key,single);}
    next.set("q",term);
    if (target > 1) next.set("page",String(target));
    return `/buscar?${next}`;
  };
  const requestedPage = Number(Array.isArray(query.page) ? query.page[0] : query.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 1 ? requestedPage : 1;
  let unavailable = false;
  const result =
    term.length >= 2 && !budget.invalid
      ? await searchProductsPage(term, { page, categorySlug:first(query.categoria), brand:first(query.marca), minPricePyg:budget.min, maxPricePyg:budget.max, sort:isCatalogSort(sort) ? sort : "relevancia" }).catch(() => {
          unavailable = true;
          return { products: [], total: 0, page, totalPages: 1 };
        })
      : { products: [], total: 0, page, totalPages: 1 };
  if (!unavailable && term.length >= 2 && page > result.totalPages) notFound();
  const results = result.products;
  const categories =
    results.length === 0 ? await getCategories().catch(() => []) : [];
  const { vidriera } = await getStoreSettings();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {term
          ? t("buscar.resultadosPara", { termino: term })
          : t("buscar.titulo")}
      </h1>

      {term.length < 2 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {t("buscar.minimo")}
        </p>
      ) : !unavailable ? (
        <p data-catalog-result-count role="status" aria-live="polite" aria-atomic="true" className="text-muted-foreground mt-1 text-sm">
          {tPlural("catalogo.productos", result.total)}
        </p>
      ) : null}

      {term.length >= 2 ? <div className="mt-5"><Suspense fallback={null}><CatalogFilters brands={facets.brands} categories={facets.categories} /></Suspense></div> : null}
      {budget.invalid ? <p role="alert">El presupuesto debe usar montos enteros entre 0 y 2.147.483.647 guaraníes.</p> : null}

      {results.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <h2 className="sr-only">{t("catalogo.tituloOculto")}</h2>
          {results.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              priority={index < 4}
              showRating={vidriera.estrellasEnTarjetas}
            />
          ))}
        </div>
      ) : term.length >= 2 ? (
        <div role={unavailable ? "status" : undefined} className="border-border mt-8 rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">
            {unavailable
              ? "El catálogo todavía no está disponible."
              : t("buscar.nada", { termino: term })}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("buscar.nada.ayuda")}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {categories.map((category) => (
              <Button key={category.id} asChild variant="outline" size="sm">
                <Link href={`/categoria/${category.slug}`}>
                  {category.name}
                </Link>
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {result.totalPages > 1 ? (
        <nav aria-label={t("nav.paginacion")} className="mt-8 flex items-center justify-center gap-3">
          {page > 1 ? <Button asChild variant="outline"><Link href={pageHref(Math.min(page - 1, result.totalPages))}>{t("nav.anterior")}</Link></Button> : null}
          <span>{t("nav.pagina", { actual: page, total: result.totalPages })}</span>
          {page < result.totalPages ? <Button asChild variant="outline"><Link href={pageHref(page + 1)}>{t("nav.siguiente")}</Link></Button> : null}
        </nav>
      ) : null}
    </main>
  );
}
