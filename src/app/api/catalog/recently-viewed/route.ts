import { getProductBySlug } from "@/db/queries";
import { displayedVariant } from "@/lib/display-price";

export const dynamic = "force-dynamic";
const MAX_RECENT_PRODUCTS = 8;
const MAX_SLUG_LENGTH = 200;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const headers = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
};

/** Public, read-only projection of at most eight published catalogue items.
 * Slug history stays in the browser. The native Worker intercepts this route.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("slugs") ?? "";
  if (!raw || raw.length > MAX_RECENT_PRODUCTS * (MAX_SLUG_LENGTH + 1))
    return Response.json({ products: [] }, { status: 400, headers });
  const slugs = [...new Set(raw.split(",").filter(Boolean))];
  if (!slugs.length || slugs.length > MAX_RECENT_PRODUCTS ||
      slugs.some(slug => slug.length > MAX_SLUG_LENGTH || !SLUG_RE.test(slug)))
    return Response.json({ products: [] }, { status: 400, headers });
  try {
    // This reader joins active categories and requires active, published products.
    const rows = await Promise.all(slugs.map(slug => getProductBySlug(slug)));
    return Response.json({
      products: rows.flatMap(product => product && product.showPrice !== false ? [{
        slug: product.slug,
        name: product.name,
        pricePyg: displayedVariant(product)?.pricePyg ?? null,
        imageCloudinaryId: product.images[0]?.cloudinaryId ?? null,
        imageAlt: product.images[0]?.alt ?? null,
      }] : []),
    }, { headers });
  } catch {
    return Response.json({ products: [] }, { status: 503, headers });
  }
}
