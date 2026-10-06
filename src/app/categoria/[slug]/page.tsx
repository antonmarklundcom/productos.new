import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";

import { CatalogFilters } from "@/components/catalog-filters";
import { ProductCard } from "@/components/product-card";
import { ProductDescription } from "@/components/product-description";
import { Button } from "@/components/ui/button";
import { CATEGORIAS_INICIALES } from "@/config/tienda";
import { CategoryIcon } from "@/components/category-icon";
import { storeCategories } from "@/components/store-categories";
import { getStoreSettings } from "@/domain/store-settings";
import { t, tPlural } from "@/i18n";
import { productImageUrl } from "@/lib/images";
import { markdownToText } from "@/lib/markdown";
import { parsePriceRange } from "@/lib/price-ranges";
import { breadcrumbJsonLd, itemListJsonLd, jsonLdScript } from "@/lib/seo";
import { siteOrigin } from "@/lib/site-url";
import {
  getBrands,
  getCategoryBySlug,
  getCategoryProducts,
  isCatalogSort,
} from "@/db/queries";

export const revalidate = 300;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Params = Promise<{ slug: string }>;

/** `cache()` memoiza por request: metadata y página comparten una consulta. */
const loadCategory = cache(async (slug: string) => {
  const category = await getCategoryBySlug(slug).catch(() => null);
  if (category) return category;
  // Only offer an initial empty landing page while the database has no categories.
  // An explicitly deactivated category keeps its template 404 behavior.
  const initial = (await storeCategories()).find((item) => item.slug === slug);
  return initial
    ? {
        ...initial,
        id: 0,
        parentId: null,
        position: 0,
        isActive: true,
        imageCloudinaryId: null,
        imageAlt: null,
        createdAt: new Date(0),
      }
    : null;
});

export async function generateStaticParams() {
  try {
    const categories = await storeCategories();
    return categories.map((category) => ({ slug: category.slug }));
  } catch {
    return CATEGORIAS_INICIALES.map((category) => ({ slug: category.slug }));
  }
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await loadCategory(slug).catch(() => null);
  if (!category) return { title: t("categoria.meta") };

  // `markdownToText`: la descripción acepta markdown (O7), y una que empiece
  // con `**Importado**` publicaría literalmente los asteriscos en el
  // resultado de Google — mismo motivo que en `producto/[slug]`.
  const description =
    markdownToText(category.description).slice(0, 160) ||
    t("categoria.metaDescripcion", { nombre: category.name });

  // Cada página sin filtros tiene su canonical. Las combinaciones de filtros
  // quedan fuera del índice y apuntan a la categoría base.
  const origin = siteOrigin();
  const query = await searchParams;
  const parsedPage = Number(first(query.page));
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 1 ? parsedPage : 1;
  const filtered = Object.keys(query).some(
    (key) => key !== "page" && Boolean(first(query[key]))
  );
  const canonical = origin
    ? new URL(
        `/categoria/${slug}${page > 1 && !filtered ? `?page=${page}` : ""}`,
        origin
      ).toString()
    : undefined;

  return {
    title: category.name,
    description,
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
    ...(canonical ? { alternates: { canonical } } : {}),
  };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const query = await searchParams;

  const category = await loadCategory(slug);
  // Ver la nota en producto/[slug]: el 404 tiene que decidirse acá, y por eso
  // esta ruta tampoco lleva loading.tsx.
  if (!category) notFound();

  // `null` sin `CLOUDINARY_CLOUD_NAME` o sin foto cargada — la página cae al
  // encabezado de texto de siempre (plan-operacion §6.3).
  const categoryImageUrl = productImageUrl(category.imageCloudinaryId, "hero");

  const sortParam = first(query.orden);
  const { min, max } = parsePriceRange(first(query.precio));
  const requestedPage = Number(first(query.page));
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 1
      ? requestedPage
      : 1;

  const { vidriera } = await getStoreSettings();
  const [result, brands] = await Promise.all([
    getCategoryProducts({
      categorySlug: slug,
      brand: first(query.marca),
      minPricePyg: min,
      maxPricePyg: max,
      sort: isCatalogSort(sortParam) ? sortParam : "relevancia",
      page,
    }).catch(() => ({
      products: [],
      total: 0,
      page: 1,
      perPage: 12,
      totalPages: 1,
    })),
    getBrands(slug).catch(() => []),
  ]);

  const buildPageHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      const single = first(value);
      if (single && key !== "page") next.set(key, single);
    }
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `?${qs}` : "?";
  };

  // JSON-LD. La miga de pan es la misma que se dibuja abajo, y el ItemList
  // numera desde la página actual: en la página 2 el primer producto es el 13,
  // no el 1. Sin `NEXT_PUBLIC_SITE_URL` las URLs salen relativas — Google las
  // resuelve contra la página, así que sigue siendo válido.
  const origin = siteOrigin();
  const jsonLd = [
    breadcrumbJsonLd(origin, [
      { name: t("nav.inicio"), path: "/" },
      { name: category.name, path: `/categoria/${slug}` },
    ]),
    itemListJsonLd(origin, result.products, {
      name: category.name,
      startPosition: (result.page - 1) * result.perPage + 1,
    }),
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />

      <nav className="text-muted-foreground text-sm">
        <Link href="/" className="hover:text-foreground">
          {t("nav.inicio")}
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{category.name}</span>
      </nav>

      <div
        className={`mt-5 mb-5 flex items-center gap-4 rounded-2xl p-6 tone-${CATEGORIAS_INICIALES.find((item) => item.slug === slug)?.tone ?? "sage"}`}
      >
        <CategoryIcon
          name={
            CATEGORIAS_INICIALES.find((item) => item.slug === slug)?.icon ??
            "home"
          }
          size={40}
          strokeWidth={1.3}
        />
        <h1 className="text-3xl font-semibold tracking-tight">
          {category.name}
        </h1>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        {tPlural("catalogo.productos", result.total)} ·{" "}
        {t("catalogo.ivaIncluidoNota")}
      </p>

      {/* Sin foto ni descripción cargadas (O7, `/admin/categorias`), esta
          página queda exactamente igual que antes de esta sección. */}
      {categoryImageUrl || category.description ? (
        <div className="mt-5">
          {categoryImageUrl ? (
            <div className="bg-muted relative aspect-[16/5] w-full overflow-hidden rounded-xl">
              <Image
                src={categoryImageUrl}
                alt={category.imageAlt ?? category.name}
                fill
                unoptimized
                priority
                sizes="(max-width: 1024px) 100vw, 1152px"
                className="object-cover"
              />
            </div>
          ) : null}
          {category.description ? (
            <ProductDescription
              markdown={category.description}
              className={categoryImageUrl ? "mt-4" : undefined}
            />
          ) : null}
        </div>
      ) : null}

      <div className="mt-5">
        <Suspense fallback={null}>
          <CatalogFilters brands={brands} />
        </Suspense>
      </div>

      {result.products.length === 0 ? (
        <div className="border-border mt-8 rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">{t("categoria.sinResultados")}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("categoria.sinResultados.ayuda")}
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href={`/categoria/${slug}`}>{t("categoria.verTodo")}</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {/* El h3 de cada ProductCard necesita un h2 arriba para no saltar
              de nivel (regla heading-order de axe) — la grilla no tiene un
              título visible propio, así que va oculto para lectores de
              pantalla. */}
          <h2 className="sr-only">{t("catalogo.tituloOculto")}</h2>
          {result.products.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              priority={index < 4}
              showRating={vidriera.estrellasEnTarjetas}
            />
          ))}
        </div>
      )}

      {result.totalPages > 1 ? (
        <nav
          className="mt-8 flex items-center justify-center gap-3"
          aria-label={t("nav.paginacion")}
        >
          {/* == S17 == En los bordes, un `<span aria-disabled>` con el mismo
              estilo del botón deshabilitado — no un `<Link>`: un `<a href>`
              sigue siendo clickeable (y navegable con teclado) aunque el
              `Button` que lo envuelve diga `disabled`, que es justo lo que
              pasaba acá antes de este PR. */}
          {result.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={buildPageHref(result.page - 1)}>
                {t("nav.anterior")}
              </Link>
            </Button>
          ) : (
            <span
              aria-disabled="true"
              className="border-input text-muted-foreground pointer-events-none rounded-md border px-3 py-1.5 text-sm opacity-50"
            >
              {t("nav.anterior")}
            </span>
          )}
          <span className="text-muted-foreground text-sm">
            {t("nav.pagina", { actual: result.page, total: result.totalPages })}
          </span>
          {result.page < result.totalPages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={buildPageHref(result.page + 1)}>
                {t("nav.siguiente")}
              </Link>
            </Button>
          ) : (
            <span
              aria-disabled="true"
              className="border-input text-muted-foreground pointer-events-none rounded-md border px-3 py-1.5 text-sm opacity-50"
            >
              {t("nav.siguiente")}
            </span>
          )}
        </nav>
      ) : null}
    </main>
  );
}
