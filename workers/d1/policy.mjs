const publicPaths = new Set(["/", "/contacto", "/envios", "/preguntas-frecuentes", "/devoluciones", "/privacidad", "/terminos", "/buscar", "/sitemap.xml", "/api/health", "/health"]);
export function d1StagingRoute(request) {
  const path = new URL(request.url).pathname;
  const admin = /^\/admin(?:\/(?:login|recuperar|restablecer|productos(?:\/(?:nuevo|\d+|exportar))?|categorias))?\/?$/.test(path);
  const publicPage = publicPaths.has(path) || /^\/(?:producto|categoria)\/[a-z0-9-]+\/?$/.test(path);
  const asset = /^\/assets\//.test(path) || /^\/(?:icon\.svg|favicon\.ico|robots\.txt)$/.test(path);
  if (!(admin || publicPage || asset)) return new Response("Feature not available in this isolated D1 catalog pilot.", {status:404});
  if (!["GET", "HEAD"].includes(request.method) && !(request.method === "POST" && admin))
    return new Response("Method not available in this staging pilot.", {status:405, headers:{allow: admin?"GET, HEAD, POST":"GET, HEAD"}});
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return new Response("Invalid origin.", {status:403});
    const size = Number(request.headers.get("content-length") || 0);
    if (size > 1048576) return new Response("Request too large.", {status:413});
  }
  return null;
}
export function protectStagingResponse(response) {
  const headers=new Headers(response.headers);
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  headers.set("cache-control", "private, no-store");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
