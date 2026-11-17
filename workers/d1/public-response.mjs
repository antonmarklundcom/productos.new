import {protectStagingResponse} from "./policy.mjs";
import {recordCacheMetric} from "./cache-metrics.mjs";

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
// Anonymous home page: long-lived entries guarded by a catalogue fingerprint.
// A kill switch (WORKERS_HOME_CACHE="0") restores the plain short-TTL behaviour.
export const HOME_TRUST_SECONDS = 30;   // served without any D1 check
export const HOME_MAX_SECONDS = 600;    // hard ceiling, even if fingerprint is unchanged
export const homeCacheEnabled = (env) => env.WORKERS_HOME_CACHE !== "0";
const homePath = (request) => new URL(request.url).pathname === "/";
// One tiny D1 read (~270 rows). Every catalogue write bumps products.revision/updated_at
// (productAuditStatements, imports, gallery, category image); categories and the
// store settings row (hero/branding) are covered explicitly. Returns null on any failure.
const FINGERPRINT_SQL = `SELECT
 (SELECT COUNT(*)||':'||COALESCE(SUM(revision),0)||':'||COALESCE(MAX(updated_at),'') FROM products) AS p,
 (SELECT COALESCE(group_concat(id||'/'||slug||'/'||name||'/'||position||'/'||is_active||'/'||COALESCE(image_cloudinary_id,'')||'/'||COALESCE(image_alt,''),'|'),'') FROM (SELECT * FROM categories ORDER BY id)) AS c,
 (SELECT COALESCE(updated_at,'') FROM store_settings WHERE id=1) AS s`;
export async function catalogFingerprint(db) {
  try {
    const row = await db.prepare(FINGERPRINT_SQL).first();
    if (!row) return null;
    const bytes = new TextEncoder().encode(`${row.p}
${row.c}
${row.s ?? ""}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...digest.slice(0, 12)].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}
function publicResponse(response, request, env, state, ttl, expiresAt, sharedMax = Infinity) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=0, s-maxage=${Math.min(ttl, sharedMax)}`);
  headers.set("x-catalog-cache", state);
  headers.set("x-catalog-expires-at", String(expiresAt));
  headers.set("date", new Date().toUTCString());
  // A HIT replays the stored render: its x-request-id belongs to the first
  // visitor and would point log correlation at the wrong request.
  if (state === "HIT") headers.delete("x-request-id");
  headers.delete("x-home-fingerprint"); headers.delete("x-home-stored-at");
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
  const home = homePath(request);
  const homeMode = Boolean(eligible && home && env.DB && homeCacheEnabled(env));
  const tag = (response, state) => { if (home) response.headers.set("x-home-cache", state); return response; };
  let cache, fingerprint = null;
  if (eligible) {
    try {
      cache = await cacheStorage.open(homeMode ? `catalog-html-home-${version}` : `catalog-html-${version}`);
      const hit = await cache.match(request);
      const expiresAt = Number(hit?.headers.get("x-catalog-expires-at") || 0);
      const remaining = Math.floor((expiresAt - Date.now()) / 1000);
      if (hit && remaining >= 1) {
        let fresh = true;
        if (homeMode) {
          const age = (Date.now() - Number(hit.headers.get("x-home-stored-at") || 0)) / 1000;
          if (!(age >= 0 && age <= HOME_TRUST_SECONDS)) {
            fingerprint = await catalogFingerprint(env.DB);
            fresh = fingerprint !== null && fingerprint === hit.headers.get("x-home-fingerprint");
          } else recordCacheMetric("home_trusted");
        }
        if (fresh) {recordCacheMetric("html_hit");return tag(publicResponse(hit, request, env, "HIT", remaining, expiresAt, homeMode ? HOME_TRUST_SECONDS : Infinity), "HIT");}
        recordCacheMetric("home_stale");
      }
    } catch { recordCacheMetric("html_read_error");cache = undefined; }
  }
  // Fingerprint is read BEFORE rendering: a catalogue write racing the render makes
  // the stored fingerprint older than the data, so the next check re-renders.
  // Render with the short data cache off so the entry cannot freeze stale rows.
  const homeStoreTtl = homeMode && cache ? HOME_MAX_SECONDS : ttl;
  if (homeMode && cache) {
    fingerprint = fingerprint ?? await catalogFingerprint(env.DB);
    if (fingerprint === null) cache = undefined;
    else if (dataContext) dataContext.enabled = false;
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
    const expiresAt = Math.min(Date.now() + homeStoreTtl * 1000, dataContext?.expiresAt ?? Infinity);
    const remaining = Math.floor((expiresAt - Date.now()) / 1000);
    if (remaining >= 1 && !dataContext?.failed && cacheableCatalogResponse(response)) {
      const result = publicResponse(response, request, env, "MISS", remaining, expiresAt, homeMode ? HOME_TRUST_SECONDS : Infinity);
      recordCacheMetric("html_miss");
      const stored = result.clone();
      if (homeMode) {
        // Internal bookkeeping stays on the stored copy only. The Cache API
        // lifetime follows this header, so it must carry the long TTL.
        stored.headers.set("cache-control", `public, max-age=${remaining}`);
        stored.headers.set("x-home-fingerprint", fingerprint);
        stored.headers.set("x-home-stored-at", String(Date.now()));
      }
      ctx.waitUntil(cache.put(request, stored).catch(() => recordCacheMetric("html_write_error")));
      return tag(result, "MISS");
    }
  }
  // Streamed readers may fail after headers were initially accepted. Never store
  // or advertise a successful public response for that completed failed render.
  const path = new URL(request.url).pathname;
  // Catalogue HTML/RSC failures become 503. Keep the deliberate static-only
  // sitemap fallback status; its XML is never eligible for the HTML cache.
  if (dataContext?.failed && response.status === 200 && (catalogPath(path) || path === "/buscar")) response = new Response(response.body,{status:503,headers:response.headers});
  recordCacheMetric("html_bypass");
  const result = protectStagingResponse(response);
  result.headers.set("x-catalog-cache", "BYPASS");
  tag(result, "BYPASS");
  if (productionPublicRequest(request, env) && ["GET", "HEAD"].includes(request.method) &&
      !/^\/(?:admin|api|checkout|pedido|cuenta|favoritos|setup|dev)(?:\/|$)/.test(new URL(request.url).pathname) &&
      !request.headers.has("cookie") && !request.headers.has("authorization") &&
      response.status === 200) result.headers.delete("x-robots-tag");
  return result;
}
