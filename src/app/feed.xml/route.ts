import { TIENDA } from "@/config/tienda";
import { getFeedProducts } from "@/db/queries";
import { productImageUrl } from "@/lib/images";
import { markdownToText } from "@/lib/markdown";
import { buildProductFeed } from "@/lib/product-feed";
import { siteOrigin } from "@/lib/site-url";
import { nombreTienda } from "@/lib/marca";

/**
 * `/feed.xml` — el catálogo para Google Merchant Center y Meta Commerce
 * Manager (`src/lib/product-feed.ts`). Se carga una sola vez en cada panel
 * con esta URL y ellos la vuelven a leer solos (NEW-STORE.md § "Google
 * Shopping y el catálogo de Meta").
 *
 * Dinámica, no ISR: con `revalidate` Next la prerenderiza en el build, y en
 * Hostinger el build no siempre ve la base. Google y Meta la leen unas pocas
 * veces por día: una consulta por lectura no es costo.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const origin = siteOrigin();
  // Sin dominio no hay links absolutos que publicar, y un feed con
  // localhost adentro le enseña a Google páginas que no existen.
  if (!origin) {
    return new Response("Falta NEXT_PUBLIC_SITE_URL: sin dominio no hay feed.", { status: 404 });
  }

  let products: Awaited<ReturnType<typeof getFeedProducts>>;
  try {
    products = await getFeedProducts();
  } catch {
    // Base caída: 503 hace que Google y Meta reintenten más tarde en vez de
    // tomar un feed vacío como "la tienda no vende nada".
    return new Response("Catálogo no disponible, probá de nuevo en un rato.", { status: 503 });
  }
  const xml = buildProductFeed({
    origin,
    tienda: { nombre: await nombreTienda(), descripcion: TIENDA.descripcion },
    products: products.map((product) => ({
      slug: product.slug,
      name: product.name,
      description: markdownToText(product.description),
      brand: product.brand,
      categoryName: product.categoryName,
      images: product.images
        .map((image) => productImageUrl(image.cloudinaryId, "detail"))
        .filter((src): src is string => src !== null),
      variants: product.variants,
    })),
  });

  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
