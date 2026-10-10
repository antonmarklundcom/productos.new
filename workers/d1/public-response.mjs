import {protectStagingResponse} from "./policy.mjs";

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
    !request.headers.has("rsc") && !request.headers.has("next-router-state-tree") &&
    !request.headers.has("next-action") && !request.headers.has("next-router-prefetch") &&
    !request.headers.has("next-url") && !request.headers.has("range") &&
    !request.headers.has("if-none-match") && !request.headers.has("if-modified-since") &&
    !/no-cache|no-store/i.test(request.headers.get("cache-control") || "") &&
    (request.headers.get("accept") || "").includes("text/html");
}
export function cacheableCatalogResponse(response) {
  // HTML is the only representation stored. Framework RSC Vary fields cannot
  // alias a flight response because its request/response types are rejected.
  const vary = (response.headers.get("vary") || "").toLowerCase().split(",").map(v => v.trim());
  return response.status === 200 && !response.headers.has("set-cookie") &&
    !/private|no-store/i.test(response.headers.get("cache-control") || "") &&
    (response.headers.get("content-type") || "").includes("text/html") &&
    vary.every(v => !v || ["rsc", "next-router-state-tree", "next-router-prefetch", "next-url", "accept-encoding"].includes(v));
}
function publicResponse(response, request, env, state, ttl) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=0, s-maxage=${ttl}`);
  headers.set("x-catalog-cache", state);
  if (productionPublicRequest(request, env)) headers.delete("x-robots-tag");
  else headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {status:response.status,statusText:response.statusText,headers});
}
export async function catalogResponse(request, env, ctx, render, cacheStorage = globalThis.caches) {
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
      if (hit) return publicResponse(hit, request, env, "HIT", ttl);
    } catch { cache = undefined; }
  }
  const response = await render();
  if (cache && cacheableCatalogResponse(response)) {
    const result = publicResponse(response, request, env, "MISS", ttl);
    ctx.waitUntil(cache.put(request, result.clone()).catch(() => {}));
    return result;
  }
  const result = protectStagingResponse(response);
  result.headers.set("x-catalog-cache", "BYPASS");
  if (productionPublicRequest(request, env) && request.method === "GET" &&
      !new URL(request.url).pathname.startsWith("/admin") &&
      !request.headers.has("cookie") && !request.headers.has("authorization") &&
      response.status === 200) result.headers.delete("x-robots-tag");
  return result;
}
