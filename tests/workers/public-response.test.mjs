import {test} from "node:test";
import assert from "node:assert/strict";
import {anonymousCatalogRequest, catalogCacheSeconds, cacheableCatalogResponse, catalogResponse, productionPublicRequest, catalogRendererCacheControl, PUBLIC_RENDER_TTL_HEADER} from "../../workers/d1/public-response.mjs";
const url="https://stage.workers.dev/producto/cepillo";
const request=(path=url,headers={})=>new Request(path,{headers:{accept:"text/html",...headers}});
const env={WORKERS_PUBLIC_CACHE_SECONDS:"60",CF_VERSION_METADATA:{id:"version-one"}};
function memoryCache(){const values=new Map();return {open:async()=>({match:async r=>values.get(r.url)?.clone(),put:async(r,s)=>{values.set(r.url,s.clone());}})};}
test("anonymous HTML cache rejects credentials, flight, variants and private routes",()=>{
 assert.equal(anonymousCatalogRequest(request()),true);
 for(const path of ["/admin","/buscar","/contacto","/api/health","/checkout","/producto/cepillo?x=1"])assert.equal(anonymousCatalogRequest(request("https://stage.workers.dev"+path)),false);
 for(const headers of [{cookie:"ecom_admin=x"},{authorization:"Bearer x"},{rsc:"1"},{"next-action":"x"},{"next-router-state-tree":"x"},{accept:"text/x-component"},{range:"bytes=0-1"},{"cache-control":"no-cache"}])assert.equal(anonymousCatalogRequest(request(url,headers)),false);
 for(const ttl of ["0","-1","301","Infinity","30.5","abc"])assert.equal(catalogCacheSeconds({WORKERS_PUBLIC_CACHE_SECONDS:ttl}),0);
 for(const headers of [{"set-cookie":"ecom_admin=x"},{"cache-control":"private, no-store"},{vary:"cookie"},{vary:"*"},{"content-type":"text/x-component"}])assert.equal(cacheableCatalogResponse(new Response("x",{headers:{"content-type":"text/html",...headers}})),false);
 assert.equal(cacheableCatalogResponse(new Response("x",{status:500,headers:{"content-type":"text/html"}})),false);
});
test("second anonymous request reuses HTML but preview remains noindex",async()=>{
 const cache=memoryCache();const pending=[];const ctx={waitUntil:p=>pending.push(p)};let calls=0;
 const render=async()=>{calls++;return new Response("catalog",{headers:{"content-type":"text/html",vary:"RSC, Next-Router-State-Tree"}});};
 const first=await catalogResponse(request(),env,ctx,render,cache);
 assert.equal(first.headers.get("x-catalog-cache"),"MISS");assert.match(first.headers.get("x-robots-tag"),/noindex/);assert.equal(await first.text(),"catalog");await Promise.all(pending);
 const second=await catalogResponse(request(),env,ctx,render,cache);
 assert.equal(second.headers.get("x-catalog-cache"),"HIT");assert.equal(await second.text(),"catalog");assert.equal(calls,1);
 await catalogResponse(request(url,{cookie:"ecom_admin=x"}),env,ctx,render,cache);assert.equal(calls,2);
});
test("private responses and new deployment cannot reuse another deployment HTML",async()=>{
 const cache=memoryCache();const pending=[];const ctx={waitUntil:p=>pending.push(p)};let calls=0;
 const namespaces=new Map();const isolated={open:async name=>{if(!namespaces.has(name))namespaces.set(name,memoryCache());return namespaces.get(name).open();}};
 const render=async()=>{calls++;return new Response("catalog",{headers:{"content-type":"text/html"}});};
 await catalogResponse(request(),env,ctx,render,isolated);await Promise.all(pending);
 await catalogResponse(request(),{...env,CF_VERSION_METADATA:{id:"version-two"}},ctx,render,isolated);assert.equal(calls,2);await Promise.all(pending);
 const privateResult=await catalogResponse(request(),env,ctx,async()=>new Response("private",{headers:{"content-type":"text/html","set-cookie":"ecom_admin=x"}}),cache);
 assert.equal(privateResult.headers.get("cache-control"),"private, no-store");assert.equal(privateResult.headers.get("set-cookie"),"ecom_admin=x");
});
test("indexing needs explicit production switch AND the configured real origin",()=>{
 const prod={WORKERS_PRODUCTION_READY:"true",NEXT_PUBLIC_SITE_URL:"https://productos.com.py"};
 assert.equal(productionPublicRequest(request("https://productos.com.py/"),prod),true);
 assert.equal(productionPublicRequest(request(),prod),false);
 assert.equal(productionPublicRequest(request(),{...prod,NEXT_PUBLIC_SITE_URL:"https://stage.workers.dev"}),false);
 assert.equal(productionPublicRequest(request("https://productos.com.py/"),{...prod,WORKERS_PRODUCTION_READY:"false"}),false);
});

test("reviewed renderer opts in only for anonymous HTML and strips client TTL spoofing",async()=>{
 const cache=memoryCache(),pending=[],ctx={waitUntil:p=>pending.push(p)};
 let rendered;
 const render=async req=>{rendered=req;return new Response("catalog",{headers:{"content-type":"text/html","cache-control":catalogRendererCacheControl(req) || "private, no-store"}});};
 const first=await catalogResponse(request(url,{[PUBLIC_RENDER_TTL_HEADER]:"300"}),env,ctx,render,cache);
 assert.equal(rendered.headers.get(PUBLIC_RENDER_TTL_HEADER),"60");
 assert.equal(first.headers.get("x-catalog-cache"),"MISS"); await Promise.all(pending);
 for(const headers of [{cookie:"ecom_admin=x"},{rsc:"1"},{authorization:"Bearer x"}]){
  const result=await catalogResponse(request(url,{...headers,[PUBLIC_RENDER_TTL_HEADER]:"300"}),env,ctx,render,cache);
  assert.equal(rendered.headers.has(PUBLIC_RENDER_TTL_HEADER),false);
  assert.equal(result.headers.get("cache-control"),"private, no-store");
 }
 const disabled=await catalogResponse(request(url,{[PUBLIC_RENDER_TTL_HEADER]:"300"}),{...env,WORKERS_PUBLIC_CACHE_SECONDS:"0"},ctx,render,cache);
 assert.equal(rendered.headers.has(PUBLIC_RENDER_TTL_HEADER),false);
 assert.equal(disabled.headers.get("x-catalog-cache"),"BYPASS");
 for(const headers of [{"x-nonce":"random"},{"content-security-policy":"script-src 'nonce-random'"}])
  assert.equal(cacheableCatalogResponse(new Response("x",{headers:{"content-type":"text/html",...headers}})),false);
});

test("current Vinext Vary fields are safe only when every corresponding request variant is absent",()=>{
 const fields=["Next-Router-Segment-Prefetch","X-Vinext-Interception-Context","X-Vinext-Interception-Id","X-Vinext-Mounted-Slots","X-Vinext-Rsc-Render-Mode","X-Vinext-Rsc-State-Fingerprint"];
 assert.equal(cacheableCatalogResponse(new Response("html",{headers:{"content-type":"text/html",vary:fields.join(", ")}})),true);
 for(const field of fields)assert.equal(anonymousCatalogRequest(request(url,{[field]:"variant"})),false);
});

test("a cache HIT does not replay the first visitor's x-request-id",async()=>{
 const cache=memoryCache(),pending=[],ctx={waitUntil:p=>pending.push(p)};
 const render=async()=>new Response("catalog",{headers:{"content-type":"text/html","x-request-id":"first-visitor-id"}});
 const first=await catalogResponse(request(),env,ctx,render,cache);
 assert.equal(first.headers.get("x-catalog-cache"),"MISS");assert.equal(first.headers.get("x-request-id"),"first-visitor-id");await Promise.all(pending);
 const second=await catalogResponse(request(),env,ctx,render,cache);
 assert.equal(second.headers.get("x-catalog-cache"),"HIT");assert.equal(second.headers.has("x-request-id"),false);
});
