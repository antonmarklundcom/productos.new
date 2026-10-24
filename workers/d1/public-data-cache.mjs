import { PUBLIC_DATA_CACHE_SECONDS } from "./public-cache-budget.mjs";
import { catalogCacheSeconds } from "./public-response.mjs";
import { recordCacheMetric } from "./cache-metrics.mjs";

const hot = new Map(), flights = new Map();
const MAX_ENTRIES = 200, MAX_FLIGHTS = 32;
let searchWindow = {start:0,loads:0,keys:new Set()};
export function publicReadContext(request, env, ctx, storage = globalThis.caches) {
 const url = new URL(request.url), ttl = Math.min(PUBLIC_DATA_CACHE_SECONDS, catalogCacheSeconds(env));
 const searchRequest = url.pathname === '/buscar' || url.pathname === '/api/catalog/suggest';
 const enabled = Boolean(ttl && env.CF_VERSION_METADATA?.id && storage && request.method === 'GET' &&
  url.protocol === 'https:' && (searchRequest || url.pathname === '/' || /^\/(producto|categoria)\/[a-z0-9-]+\/?$/.test(url.pathname)) &&
  !['cookie','authorization','next-action','range'].some(h=>request.headers.has(h)) && !/no-cache|no-store/i.test(request.headers.get('cache-control')||''));
 return {diagnostics:env.WORKERS_PUBLIC_DIAGNOSTICS==='true',batches:/** @type {{wallMs:number,statements:number,rowsRead:number,serviceMs:number,failed?:boolean}[]} */([]),enabled,searchRequest,ttl,namespace:`catalog-data-v2-${env.CF_VERSION_METADATA?.id}-${url.origin}`,origin:url.origin,storage,ctx,failed:false,memo:new Map(),productSlugs:new Map(),loads:/** @type {{reader:string,durationMs:number}[]} */([]),expiresAt:Infinity};
}
function record(context, entry) {context.expiresAt=Math.min(context.expiresAt,entry.expiresAt);return structuredClone(entry.value);}
export function validSearchCacheKey(key) {
 try{const prefix=key.split(':')[0];if(!['search','facets','suggest'].includes(prefix))return true;
  if(key.length>2048)return false;
  const raw=key.slice(prefix.length+1),term=prefix==='facets'?raw:JSON.parse(raw)[0];
  return typeof term==='string' && term.length>=2 && term.length<=160 && term.split(/\s+/).filter(Boolean).length<=12;
 }catch{return false;}
}
function admitSearchLoad(context,key,now) {
 if(!context.searchRequest || !/^(?:search|facets|suggest):/.test(key))return;
 const time=now();if(time-searchWindow.start>=30000 || time<searchWindow.start)searchWindow={start:time,loads:0,keys:new Set()};
 // Per-isolate load/cardinality bounds supplement safe SQL/query bounds. Cache
 // hits do not spend this cold-read budget. There is no global traffic guarantee.
 if(searchWindow.loads>=256 || (!searchWindow.keys.has(key)&&searchWindow.keys.size>=64)){
  recordCacheMetric('search_admission_bypass');throw new Error('CATALOG_SEARCH_BUSY');
 }
 searchWindow.keys.add(key);searchWindow.loads++;
}
export async function cachedPublicRead(context,key,load,now=Date.now) {
 if(!context)return load();
 if(context.memo.has(key))return context.memo.get(key).then(entry=>record(context,entry));
 const promise=(async()=>{
  if(!context.enabled || !validSearchCacheKey(key)){recordCacheMetric('data_bypass');admitSearchLoad(context,key,now);return{value:await load(),expiresAt:Infinity};}
  const identity=context.namespace+':'+key,warm=hot.get(identity);
  if(warm && warm.expiresAt>now()){hot.delete(identity);hot.set(identity,warm);recordCacheMetric('data_hot_hit');return warm;}
  hot.delete(identity);if(flights.has(identity))return flights.get(identity);
  if(flights.size>=MAX_FLIGHTS){admitSearchLoad(context,key,now);recordCacheMetric('data_bypass');return{value:await load(),expiresAt:Infinity};}
  const flight=(async()=>{
   let cache;const request=new Request(`${context.origin}/__public-data/${encodeURIComponent(key)}`);
   try{cache=await context.storage.open(context.namespace);const hit=await cache.match(request);if(hit){const entry=await hit.json();if(Number.isFinite(entry.expiresAt)&&entry.expiresAt>now()){recordCacheMetric('data_hit');return entry;}}}
   catch{recordCacheMetric('data_read_error');cache=undefined;}
   admitSearchLoad(context,key,now);
   const expiresAt=now()+context.ttl*1000,value=await load(),entry={value,expiresAt},seconds=Math.floor((expiresAt-now())/1000);
   recordCacheMetric('data_miss');
   if(cache && seconds>=1 && !context.failed)context.ctx.waitUntil(cache.put(request,Response.json(entry,{headers:{'cache-control':`public, max-age=${seconds}`}})).catch(()=>recordCacheMetric('data_write_error')));
   return entry;
  })();
  flights.set(identity,flight);
  try{const entry=await flight;if(entry.expiresAt>now()){hot.set(identity,entry);while(hot.size>MAX_ENTRIES)hot.delete(hot.keys().next().value);}return entry;}
  finally{flights.delete(identity);}
 })();
 context.memo.set(key,promise);
 try{return record(context,await promise);}catch(error){context.failed=true;context.memo.delete(key);throw error;}
}
