import manifest from "./catalog-demo/manifest.mjs";

/** Explicit visual snapshot. Never claim a working remote database. */
export async function serveCatalogDemo(request, env) {
  const url = new URL(request.url);
  if (["/health", "/api/health"].includes(url.pathname))
    return Response.json({ ok: true, db: false, cron: false, previewMode: "catalog-snapshot", products: manifest.products, images: manifest.images, capturedAt: manifest.capturedAt });
  const page = Number(url.searchParams.get("page") || 1);
  const key = url.pathname.replace(/\/$/, "") || "/";
  const route = page > 1 && Number.isSafeInteger(page) ? `${key}?page=${page}` : key;
  const asset = manifest.routes[route];
  if (!asset) return new Response("This page is unavailable in the catalog demo.", { status: 404 });
  const assetUrl = new URL(`/__catalog-demo/${asset}.html`, url.origin);
  const response = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method }));
  if (response.status !== 200) return new Response("Catalog demo asset is unavailable.", { status: 503 });
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://imagenes.productos.com.py data:; font-src 'self'; connect-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
  headers.set("x-preview-mode", "catalog-snapshot");
  return new Response(request.method === "HEAD" ? null : response.body, { status: 200, headers });
}
