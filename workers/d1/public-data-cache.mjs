import { PUBLIC_DATA_CACHE_SECONDS } from "./public-cache-budget.mjs";
import { catalogCacheSeconds } from "./public-response.mjs";

// Each isolate has a bounded hot cache. Cache API persists public DTOs in its colo.
const hot = new Map(), flights = new Map();
const MAX_ENTRIES = 200;
export function publicReadContext(request, env, ctx, storage = globalThis.caches) {
 const url = new URL(request.url);
 // Reserve 30 seconds for Vinext full-prefetch reuse (Workers build config).
 const ttl = Math.min(PUBLIC_DATA_CACHE_SECONDS, catalogCacheSeconds(env));
 const enabled = Boolean(ttl && env.CF_VERSION_METADATA?.id && storage && request.method === "GET" &&
   url.protocol === "https:" && (url.pathname === "/" || /^\/(producto|categoria)\/[a-z0-9-]+\/?$/.test(url.pathname)) &&
   !["cookie", "authorization", "next-action", "range"].some(header => request.headers.has(header)) &&
   !/no-cache|no-store/i.test(request.headers.get("cache-control") || ""));
 return {enabled, ttl, namespace: `catalog-data-v1-${env.CF_VERSION_METADATA?.id}-${url.origin}`,
   origin: url.origin, storage, ctx, failed: false, memo: new Map(), productSlugs: new Map(), loads: /** @type {{reader:string,durationMs:number}[]} */ ([]), expiresAt: Infinity};
}
function record(context, entry) {
 context.expiresAt = Math.min(context.expiresAt, entry.expiresAt);
 return structuredClone(entry.value);
}
export async function cachedPublicRead(context, key, load, now = Date.now) {
 if (!context) return load();
 if (context.memo.has(key)) return context.memo.get(key).then(entry => record(context, entry));
 const promise = (async () => {
   if (!context.enabled) return {value: await load(), expiresAt: Infinity};
   const identity = context.namespace + ":" + key;
   const warm = hot.get(identity);
   if (warm && warm.expiresAt > now()) {
     hot.delete(identity); hot.set(identity, warm);
     return warm;
   }
   hot.delete(identity);
   if (flights.has(identity)) return flights.get(identity);
   const flight = (async () => {
     let cache;
     const request = new Request(`${context.origin}/__public-data/${encodeURIComponent(key)}`);
     try {
       cache = await context.storage.open(context.namespace);
       const hit = await cache.match(request);
       if (hit) {
         const entry = await hit.json();
         if (Number.isFinite(entry.expiresAt) && entry.expiresAt > now()) return entry;
       }
     } catch { cache = undefined; }
     // Start the freshness clock BEFORE D1, including query/transport time.
     const expiresAt = now() + context.ttl * 1000;
     const value = await load();
     const entry = {value, expiresAt};
     const seconds = Math.floor((expiresAt - now()) / 1000);
     if (cache && seconds >= 1) context.ctx.waitUntil(cache.put(request, Response.json(entry, {
       headers: {"cache-control": `public, max-age=${seconds}`},
     })).catch(() => {}));
     return entry;
   })();
   flights.set(identity, flight);
   try {
     const entry = await flight;
     if (entry.expiresAt > now()) {
       hot.set(identity, entry);
       while (hot.size > MAX_ENTRIES) hot.delete(hot.keys().next().value);
     }
     return entry;
   } finally { flights.delete(identity); }
 })();
 context.memo.set(key, promise);
 try { return record(context, await promise); }
 catch (error) { context.failed = true; context.memo.delete(key); throw error; }
}
