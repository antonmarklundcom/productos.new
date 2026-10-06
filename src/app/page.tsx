import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Search,
  PackageCheck,
  SlidersHorizontal,
} from "lucide-react";
import { HomeHero } from "@/components/home-hero";
import { ProductCard } from "@/components/product-card";
import { CategoryIcon } from "@/components/category-icon";
import { TIENDA, CATEGORIAS_INICIALES } from "@/config/tienda";
import { isLocalCatalogPreview } from "@/config/preview";
import {
  getCatalog,
  getCategoryProducts,
  type CatalogProduct,
} from "@/db/queries";
import { storeCategories } from "@/components/store-categories";
import { getStoreSettings } from "@/domain/store-settings";
import { heroEfectivo } from "@/domain/store-settings-schema";
import { contactoPublico } from "@/lib/comercio";
import { jsonLdScript, organizationJsonLd } from "@/lib/seo";
import { siteOrigin } from "@/lib/site-url";
import { nombreTienda } from "@/lib/marca";
import { t } from "@/i18n";

export const revalidate = 300;
export function generateMetadata(): Metadata {
  const origin = siteOrigin();
  return origin ? { alternates: { canonical: origin.origin } } : {};
}

export default async function HomePage() {
  const [
    categories,
    destacados,
    catalog,
    recientes,
    ajustes,
    contacto,
    nombre,
  ] = await Promise.all([
    storeCategories(),
    getCatalog({ featured: true, limit: 4 }).catch(() => []),
    getCatalog({ limit: 4 })
      .then((products) => ({ products, unavailable: false }))
      .catch(() => ({ products: [], unavailable: true })),
    Promise.all(
      CATEGORIAS_INICIALES.map((category) =>
        getCategoryProducts({
          categorySlug: category.slug,
          sort: "nuevos",
          perPage: 1,
        }).catch(() => null)
      )
    ),
    getStoreSettings(),
    contactoPublico(),
    nombreTienda(),
  ]);
  const catalogUnavailable = catalog.unavailable;
  const featured = destacados.length ? destacados : catalog.products;
  const latest = recientes
    .flatMap((result) => result?.products ?? [])
    .slice(0, 4);
  const hero = heroEfectivo(
    ajustes.marca,
    TIENDA.hero ?? { titulo: TIENDA.titulo }
  );
  const sections = categories;
  const preview = isLocalCatalogPreview();
  const organization = organizationJsonLd({
    origin: siteOrigin(),
    name: nombre,
    telephone: contacto.whatsapp,
    email: contacto.email,
    sameAs: contacto.redes.map((red) => red.url),
  });

  return (
    <main className="store-width home-main">
      {catalogUnavailable ? (
        <div
          className="bg-muted mb-5 rounded-xl border p-4 text-sm"
          role="status"
        >
          <p>{t("home.errorCatalogo")}</p>
          <p className="text-muted-foreground mt-1">
            {t("home.errorCatalogo.ayuda")}
          </p>
        </div>
      ) : null}
      {organization ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(organization) }}
        />
      ) : null}
      {hero ? (
        <HomeHero hero={hero} />
      ) : (
        <h1 className="sr-only">{ajustes.marca.seoTitulo ?? TIENDA.titulo}</h1>
      )}
      <div className="shopping-strip grid gap-4 py-6 sm:grid-cols-3">
        <div>
          <Search size={20} aria-hidden />
          <span>
            <strong>Encontrá con facilidad</strong>
            <small>Buscá por nombre o explorá por categoría.</small>
          </span>
        </div>
        <div>
          <SlidersHorizontal size={20} aria-hidden />
          <span>
            <strong>Elegí a tu manera</strong>
            <small>Compará las opciones del catálogo.</small>
          </span>
        </div>
        <div>
          <PackageCheck size={20} aria-hidden />
          <span>
            <strong>Tené todo a mano</strong>
            <small>Consultá la información de tu pedido.</small>
          </span>
        </div>
      </div>
      <section
        id="categorias"
        aria-label={t("home.categorias")}
        className="home-section scroll-mt-48"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Un poco de todo, para vos</p>
            <h2>¿Qué estás buscando?</h2>
          </div>
          <span className="text-muted-foreground hidden text-sm sm:block">
            Explorá nuestras categorías
          </span>
        </div>
        <div className="category-grid grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {sections.map((category) => {
            const style = CATEGORIAS_INICIALES.find(
              (item) => item.slug === category.slug
            );
            return (
              <Link
                key={category.slug}
                aria-label={`${category.name} — ${t("home.categorias.verTodo")}`}
                href={`/categoria/${category.slug}`}
                className={`category-tile tone-${style?.tone ?? "sage"}`}
              >
                <div className="flex items-start justify-between">
                  <CategoryIcon
                    name={style?.icon ?? "home"}
                    size={36}
                    strokeWidth={1.4}
                  />
                  <ArrowUpRight size={16} />
                </div>
                <h3>{category.name}</h3>
                <p>{style?.short ?? "Explorá la categoría"}</p>
              </Link>
            );
          })}
        </div>
      </section>
      <Collection
        title={t("home.destacados")}
        eyebrow="Una selección del catálogo"
        items={featured}
        preview={preview}
        empty="Estamos preparando nuestra primera selección. Volvé pronto para conocer el catálogo real."
        showRating={ajustes.vidriera.estrellasEnTarjetas}
      />
      <div className="discovery-banner">
        <div>
          <p className="eyebrow">Encontrá tu próxima idea</p>
          <h2>
            Tu casa. Tus proyectos.
            <br />
            Tus pequeños momentos.
          </h2>
          <p>Explorá desde lo cotidiano hasta lo que te inspira.</p>
          <Link href="/#categorias">
            Elegí una categoría <ArrowRight size={17} aria-hidden />
          </Link>
        </div>
        <div className="discovery-art" aria-hidden>
          <CategoryIcon name="home" size={90} strokeWidth={1} />
          <CategoryIcon name="outdoor" size={95} strokeWidth={1} />
          <CategoryIcon name="pets" size={70} strokeWidth={1} />
        </div>
      </div>
      {!preview ? (
        <Collection
          title={t("home.novedades")}
          eyebrow="Nuevas ideas para tu día"
          items={latest}
          preview={preview}
          empty="Las novedades van a aparecer acá cuando se publique el catálogo. Todavía no recibimos pedidos."
          showRating={ajustes.vidriera.estrellasEnTarjetas}
        />
      ) : null}
      <section className="help-panel">
        <div>
          <p className="eyebrow">Antes de elegir</p>
          <h2>
            La información que necesitás,
            <br className="hidden sm:block" /> siempre a mano.
          </h2>
        </div>
        <div className="help-links">
          {[
            ["Envíos y entregas", "/envios"],
            ["Cambios y devoluciones", "/devoluciones"],
            ["Preguntas frecuentes", "/preguntas-frecuentes"],
            ["Contacto", "/contacto"],
          ].map(([label, href]) => (
            <Link key={href} href={href!}>
              {label}
              <ArrowUpRight size={18} aria-hidden />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function Collection({
  title,
  eyebrow,
  items,
  preview,
  empty,
  showRating,
}: {
  title: string;
  eyebrow: string;
  items: CatalogProduct[];
  preview: boolean;
  empty: string;
  showRating: boolean;
}) {
  return (
    <section className="home-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {preview ? (
          <span className="demo-label">Demostración local</span>
        ) : null}
      </div>
      {items.length ? (
        <div
          className={
            preview && items.length === 1
              ? "collection-demo"
              : "grid grid-cols-2 gap-4 lg:grid-cols-4"
          }
        >
          {items.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              priority={index < 2}
              showRating={showRating}
            />
          ))}
          {preview && items.length === 1 ? (
            <aside>
              <p className="eyebrow">Un momento para vos</p>
              <h3>
                Tu música.
                <br />
                Tu momento.
              </h3>
              <p>
                Desconectá del ruido de tu día. Descubrí una ficha con imágenes,
                información y un precio de ejemplo.
              </p>
              <Link className="hero-cta" href={`/producto/${items[0]!.slug}`}>
                Conocé el producto demo <ArrowRight size={18} aria-hidden />
              </Link>
              <p className="text-xs">
                Demostración local · No está a la venta.
              </p>
            </aside>
          ) : null}
        </div>
      ) : (
        <div className="catalog-pending">
          <PackageCheck size={28} strokeWidth={1.5} aria-hidden />
          <div>
            <h3>{t("home.sinProductos")}</h3>
            <p>{empty}</p>
          </div>
          <Link
            href="/preguntas-frecuentes"
            aria-label="Conocé cómo funciona el catálogo"
          >
            <ArrowUpRight size={22} aria-hidden />
          </Link>
        </div>
      )}
    </section>
  );
}
