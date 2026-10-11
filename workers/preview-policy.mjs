const publicPage = /^\/(?:categoria|producto)\/[a-z0-9-]+\/?$/;
const publicPaths = new Set(["/", "/contacto", "/envios", "/preguntas-frecuentes", "/devoluciones", "/privacidad", "/terminos", "/buscar", "/sitemap.xml", "/api/health", "/health"]);

function previewResponse(body, status, extraHeaders = {}) {
  return new Response(body, { status, headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Cache-Control": "no-store",
    ...extraHeaders,
  } });
}

/** Anonymous public-only pilot. Never expose mutations or private routes here. */
export async function handlePreviewRequest(request, next) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return previewResponse("This preview is read-only.", 405, { Allow: "GET, HEAD" });
  const { pathname } = new URL(request.url);
  if (pathname === "/robots.txt")
    return previewResponse(request.method === "HEAD" ? null : "User-agent: *\nDisallow: /\n", 200);
  if (!publicPaths.has(pathname) && !publicPage.test(pathname))
    return previewResponse("This route is unavailable in the public preview.", 404);

  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("authorization");
  const response = await next(new Request(request, { headers }));
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.delete("set-cookie");
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status, statusText: response.statusText, headers: responseHeaders,
  });
}
