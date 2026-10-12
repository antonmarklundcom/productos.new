const publicPaths = new Set(["/", "/buscar", "/contacto", "/envios", "/devoluciones", "/preguntas-frecuentes", "/privacidad", "/terminos", "/api/health", "/health"]);
const denied = (body, status, headers = {}) => new Response(body, {status, headers:{"cache-control":"private, no-store","x-robots-tag":"noindex, nofollow, noarchive","x-preview-read-only":"true",...headers}});
/** D1/R2 bindings are writable capabilities: block every mutation entry route. */
export function readOnlyPreviewRoute(request) {
  const path = new URL(request.url).pathname;
  if (!["GET","HEAD"].includes(request.method) || request.headers.has("next-action")) return denied("Read-only catalogue preview.",405,{allow:"GET, HEAD"});
  if (path === "/robots.txt") return denied(request.method === "HEAD" ? null : "User-agent: *\nDisallow: /\n",200,{"content-type":"text/plain"});
  if (path === "/admin" || path === "/admin/") return denied(null,307,{location:"/admin/login"});
  if (!(publicPaths.has(path) || /^\/(?:producto|categoria)\/[a-z0-9-]+\/?$/.test(path) || /^\/(?:_next\/static\/|assets\/)/.test(path) || /^\/(?:icon.svg|favicon.ico)$/.test(path))) return denied("Unavailable in read-only preview.",404);
  return null;
}
export function makeReadOnlyPreview(worker) {
  return {async fetch(request,env,ctx) {
    const blocked = readOnlyPreviewRoute(request);
    if (blocked) return blocked;
    const response = await worker.fetch(request,{...env,WORKERS_PRODUCTION_READY:"false"},ctx);
    const headers = new Headers(response.headers);
    headers.set("x-robots-tag","noindex, nofollow, noarchive");
    headers.set("x-preview-read-only","true");
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }};
}
