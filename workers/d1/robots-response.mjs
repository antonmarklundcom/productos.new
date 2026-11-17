import {productionPublicRequest} from "./public-response.mjs";
// The Cloudflare zone prepends its own managed block at the edge, so only the app part lives here.
// Constant /robots.txt for the production origin: no app render, no D1, no nonce.
// tests/unit/robots-constant.test.ts keeps this equal to src/app/robots.ts output.
export const ROBOTS_TXT = "User-Agent: *\nAllow: /\nDisallow: /admin$\nDisallow: /admin/\nDisallow: /admin?\nDisallow: /api$\nDisallow: /api/\nDisallow: /api?\nDisallow: /checkout$\nDisallow: /checkout/\nDisallow: /checkout?\nDisallow: /pedido$\nDisallow: /pedido/\nDisallow: /pedido?\nDisallow: /cuenta$\nDisallow: /cuenta/\nDisallow: /cuenta?\nDisallow: /dev$\nDisallow: /dev/\nDisallow: /dev?\nDisallow: /favoritos$\nDisallow: /favoritos/\nDisallow: /favoritos?\nDisallow: /setup$\nDisallow: /setup/\nDisallow: /setup?\n\nSitemap: https://productos.com.py/sitemap.xml\n";
export function robotsResponse(request, env) {
  if (!["GET", "HEAD"].includes(request.method)) return null;
  const url = new URL(request.url);
  if (url.pathname !== "/robots.txt" || url.search || !productionPublicRequest(request, env)) return null;
  return new Response(request.method === "HEAD" ? null : ROBOTS_TXT, {headers: {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "public, max-age=3600",
    "x-content-type-options": "nosniff",
  }});
}
