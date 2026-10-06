import type { MetadataRoute } from "next";

import { getSitemapEntries } from "@/db/queries";
import { paginasActivas } from "@/lib/paginas";
import { buildSitemap } from "@/lib/seo";
import { siteOrigin } from "@/lib/site-url";
import { storeCategories } from "@/components/store-categories";
import { getStoreSettings } from "@/domain/store-settings";
import { PAGINAS } from "@/domain/store-settings-schema";

/**
 * `/sitemap.xml` — la home, las categorías activas, los productos publicados
 * y las páginas de políticas prendidas.
 *
 * Mismo revalidate que el catálogo: el sitemap no tiene por qué ser más fresco
 * que las páginas que lista.
 */
export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  // Sin origen público no hay URL absoluta que publicar, y el sitemap las
  // exige. Vacío es honesto; un dominio adivinado le enseña al buscador
  // páginas que no existen.
  if (!origin) return [];

  // Las páginas de políticas prendidas desde `/admin/ajustes`. Sin base,
  // `getStoreSettings` devuelve los defaults (todas prendidas), que es lo que
  // la tienda sirve en ese momento.
  const settings = await getStoreSettings();
  const pages = [
    ...new Set([
      ...(await paginasActivas()).map((pagina) => pagina.slug),
      ...PAGINAS.filter((slug) => settings.paginas[slug].cuerpo === null),
      "contacto",
    ]),
  ];

  try {
    const entries = await getSitemapEntries();
    return buildSitemap(origin, {
      ...entries,
      categories: entries.categories.length
        ? entries.categories
        : (await storeCategories()).map((category) => ({
            slug: category.slug,
          })),
      pages,
    });
  } catch {
    // La base caída no puede tumbar el sitio: al menos la home se publica, y
    // el crawler vuelve en el próximo revalidate.
    return buildSitemap(origin, {
      categories: (await storeCategories()).map((category) => ({
        slug: category.slug,
      })),
      products: [],
      pages,
    });
  }
}
