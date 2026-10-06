import type { MetadataRoute } from "next";

import { RUTAS_PRIVADAS } from "@/lib/seo";
import { siteOrigin } from "@/lib/site-url";

/**
 * `/robots.txt`.
 *
 * La lista de rutas privadas vive en `lib/seo.ts` para que el test la lea del
 * mismo lugar que la ruta: un `/cuenta` nuevo que se olvide acá se indexa en
 * silencio y no hay forma de enterarse.
 *
 * El `sitemap:` sólo se declara si hay `NEXT_PUBLIC_SITE_URL`. Apuntar a un
 * dominio inventado es mandar al crawler a un 404 propio.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: RUTAS_PRIVADAS.flatMap((ruta) => [
        `${ruta}$`,
        `${ruta}/`,
        `${ruta}?`,
      ]),
    },
    ...(origin ? { sitemap: `${origin.origin}/sitemap.xml` } : {}),
  };
}
