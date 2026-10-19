import {protectStagingResponse} from "./policy.mjs";

const representationHeaders = ["rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch", "next-url", "x-vinext-interception-context", "x-vinext-interception-id", "x-vinext-mounted-slots", "x-vinext-rsc-render-mode", "x-vinext-rsc-state-fingerprint"];
const catalogPath = (path) => path === "/" || /^\/(?:producto|categoria)\/[a-z0-9-]+\/?$/.test(path);
export function productionPublicRequest(request, env) {
  if (env.WORKERS_PRODUCTION_READY !== "true") return false;
  try {
    const expected = new URL(env.NEXT_PUBLIC_SITE_URL);
    const actual = new URL(request.url);
    return expected.protocol === "https:" && actual.origin === expected.origin &&
      !expected.hostname.endsWith(".workers.dev") && !expected.hostname.endsWith(".invalid");
  } catch { return false; }
}
export function catalogCacheSeconds(env) {
  const value = Number(env.WORKERS_PUBLIC_CACHE_SECONDS || 0);
  return Number.isInteger(value) && value >= 30 && value <= 300 ? value : 0;
}
export function anonymousCatalogRequest(request) {
  const url = new URL(request.url);
  return request.method === "GET" && url.protocol === "https:" && catalogPath(url.pathname) &&
    !url.search && !request.headers.has("cookie") && !request.headers.has("authorization") &&
    representationHeaders.every(header => !request.headers.has(header)) &&
    !request.headers.has("next-action") && !request.headers.has("range") &&
    !request.headers.has("if-none-match") && !request.headers.has("if-modified-since") &&
    !/no-cache|no-store/i.test(request.headers.get("cache-control") || "") &&
    (request.headers.get("accept") || "").includes("text/html");
}
// Only the Worker wrapper may supply this header. It strips client values on every render.
export const PUBLIC_RENDER_TTL_HEADER = "x-productos-public-render-ttl";
export function catalogRendererCacheControl(request) {
  const ttl = catalogCacheSeconds({WORKERS_PUBLIC_CACHE_SECONDS: request.headers.get(PUBLIC_RENDER_TTL_HEADER)});
  return ttl && anonymousCatalogRequest(request) ? `public, max-age=0, s-maxage=${ttl}` : null;
}
export function cacheableCatalogResponse(response) {
  // HTML is the only representation stored. Framework RSC Vary fields cannot
  // alias a flight response because its request/response types are rejected.
  const vary = (response.headers.get("vary") || "").toLowerCase().split(",").map(v => v.trim());
  return response.status === 200 && !response.headers.has("set-cookie") &&
    !response.headers.has("x-nonce") &&
    !/\bnonce-/i.test(response.headers.get("content-security-policy") || "") &&
    !/private|no-store/i.test(response.headers.get("cache-control") || "") &&
    (response.headers.get("content-type") || "").includes("text/html") &&
    vary.every(v => !v || [...representationHeaders, "accept-encoding"].includes(v));
}
function publicResponse(response, request, env, state, ttl, expiresAt) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=0, s-maxage=${ttl}`);
  headers.set("x-catalog-cache", state);
  headers.set("x-catalog-expires-at", String(expiresAt));
  headers.set("date", new Date().toUTCString());
  // A HIT replays the stored render: its x-request-id belongs to the first
  // visitor and would point log correlation at the wrong request.
  if (state === "HIT") headers.delete("x-request-id");
  if (productionPublicRequest(request, env)) headers.delete("x-robots-tag");
  else headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {status:response.status,statusText:response.statusText,headers});
}
export async function catalogResponse(request, env, ctx, render, cacheStorage = globalThis.caches, dataContext) {
  const ttl = catalogCacheSeconds(env);
  const version = env.CF_VERSION_METADATA?.id;
  // The explicit switch is restricted to this enquiry catalog pilot. Stock,
  // payment and checkout actions remain blocked; displayed prices may be at
  // most TTL seconds old. Private/cookie/RSC requests never share this cache.
  const eligible = ttl > 0 && version && anonymousCatalogRequest(request) && cacheStorage;
  let cache;
  if (eligible) {
    try {
      cache = await cacheStorage.open(`catalog-html-${version}`);
      const hit = await cache.match(request);
      const expiresAt = Number(hit?.headers.get("x-catalog-expires-at") || 0);
      const remaining = Math.floor((expiresAt - Date.now()) / 1000);
      if (hit && remaining >= 1) return publicResponse(hit, request, env, "HIT", remaining, expiresAt);
    } catch { cache = undefined; }
  }
  // Framework ISR remains disabled. The reviewed anonymous catalog render
  // opts in at middleware; explicit private/no-store response policies still win.
  const renderHeaders = new Headers(request.headers);
  renderHeaders.delete(PUBLIC_RENDER_TTL_HEADER);
  if (eligible) renderHeaders.set(PUBLIC_RENDER_TTL_HEADER, String(ttl));
  let response = await render(new Request(request, {headers: renderHeaders}));
  if (cache && cacheableCatalogResponse(response) && !dataContext?.failed) {
    // Finish anonymous HTML so all streamed readers have recorded their expiry.
    // RSC keeps streaming and never enters this response cache.
    const body = await response.arrayBuffer();
    response = new Response(body, {status:response.status,statusText:response.statusText,headers:response.headers});
    const expiresAt = Math.min(Date.now() + ttl * 1000, dataContext?.expiresAt ?? Infinity);
    const remaining = Math.floor((expiresAt - Date.now()) / 1000);
    if (remaining >= 1) {
      const result = publicResponse(response, request, env, "MISS", remaining, expiresAt);
      ctx.waitUntil(cache.put(request, result.clone()).catch(() => {}));
      return result;
    }
  }
  const result = protectStagingResponse(response);
  result.headers.set("x-catalog-cache", "BYPASS");
  if (productionPublicRequest(request, env) && request.method === "GET" &&
      !new URL(request.url).pathname.startsWith("/admin") &&
      !request.headers.has("cookie") && !request.headers.has("authorization") &&
      response.status === 200) result.headers.delete("x-robots-tag");
  return result;
}
