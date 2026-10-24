import {catalogRead} from './public-catalog-sql.mjs';
import {suggestionsRead,normalizeSearchTerm} from './catalog-search-sql.mjs';
import {publicReadContext,cachedPublicRead} from './public-data-cache.mjs';
import {protectStagingResponse} from './policy.mjs';
const json=(body,status=200)=>protectStagingResponse(Response.json(body,{status}));
export async function handleCatalogApi(request,db,env={},ctx={waitUntil(){}}) {
 const url=new URL(request.url),health=['/health','/api/health'].includes(url.pathname);
 if(!health && !['/api/catalog/recently-viewed','/api/catalog/suggest'].includes(url.pathname))return null;
 if(!['GET','HEAD'].includes(request.method))return json({ok:false},405);
 let response;
 if(health && url.searchParams.get('live')==='1')response=json({ok:true,mode:'d1-staging'});
 else if(!db)response=json({ok:false,db:false,mode:'d1-staging'},503);
 else try {
  if(health){
   await db.prepare('SELECT 1 AS ready').first();
   const body={ok:true,db:true,mode:'d1-staging',cron:false};
   // Explicit diagnostics only; ordinary readiness does not scan catalogue tables.
   if(url.searchParams.get('details')==='1')body.counts=await db.prepare('SELECT (SELECT COUNT(*) FROM products) products, (SELECT COUNT(*) FROM product_images) images, (SELECT COUNT(*) FROM categories) categories').first();
   response=json(body);
  }else if(url.pathname==='/api/catalog/suggest'){
   const term=normalizeSearchTerm(url.searchParams.get('q')||'');
   if(term.length<2 || term.length>80 || term.split(/\s+/).length>12)return json({products:[]});
   const context=publicReadContext(request,env,ctx);
   const products=await cachedPublicRead(context,'suggest:'+JSON.stringify([term,6]),()=>suggestionsRead(db,term,6));
   response=json({products});
  }else{
   const slugs=[...new Set((url.searchParams.get('slugs')||'').split(',').filter(Boolean))];
   if(!slugs.length || slugs.length>8 || slugs.some(s=>s.length>200||! /^[a-z0-9-]+$/.test(s)))return json({products:[],error:'Identificadores inválidos.'},400);
   const rows=(await db.prepare(`SELECT p.id FROM products p JOIN categories c ON c.id=p.category_id WHERE p.is_active=1 AND p.published_at IS NOT NULL AND c.is_active=1 AND p.show_price=1 AND p.slug IN (${slugs.map(()=>'?').join(',')})`).bind(...slugs).all()).results;
   const products=rows.length?await catalogRead(db,{productIds:rows.map(r=>r.id),limit:8}):[];
   response=json({products:slugs.flatMap(slug=>{const p=products.find(item=>item.slug===slug);return p&&p.showPrice!==false?[p]:[];}).map(p=>({slug:p.slug,name:p.name,pricePyg:p.variants.length?Math.min(...p.variants.map(v=>v.pricePyg)):null,imageCloudinaryId:p.image?.cloudinaryId??null,imageAlt:p.image?.alt??null}))});
  }
 }catch{return json(health?{ok:false,db:false,mode:'d1-staging'}:{products:[],error:'Catálogo no disponible.'},503);}
 return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
}
