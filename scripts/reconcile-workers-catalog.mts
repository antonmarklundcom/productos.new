import {getPlatformProxy} from "wrangler";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import type {D1Binding} from "../workers/d1/database";

type CatalogRow={id:number;slug:string;name:string;dropi_url:string|null;sale_mode:string;show_price:number;is_active:number;published_at:string|null;category:string;category_slug:string;sku:string;price_pyg:number;on_hand:number;image_count:number};
const output=process.argv[2];
if(!output)throw new Error("Pass an existing artifact destination; this command only reads staging D1 and the public live sitemap.");
const proxy=await getPlatformProxy<{DB:D1Binding}>({configPath:"workers/d1/remote-test.wrangler.jsonc",persist:false});
try{
 const counts=await proxy.env.DB.prepare("SELECT (SELECT COUNT(*) FROM products) products,(SELECT COUNT(*) FROM product_images) images,(SELECT COUNT(*) FROM categories) categories,(SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM orders) orders").first();
 const rows=(await proxy.env.DB.prepare("SELECT p.id,p.slug,p.name,p.dropi_url,p.sale_mode,p.show_price,p.is_active,p.published_at,c.name category,c.slug category_slug,v.sku,v.price_pyg,v.on_hand,(SELECT COUNT(*) FROM product_images i WHERE i.product_id=p.id) image_count FROM products p JOIN categories c ON c.id=p.category_id JOIN variants v ON v.product_id=p.id ORDER BY p.id,v.position,v.id").all()).results as CatalogRow[];
 const fixture=JSON.parse(await readFile("C:/dev/workers-local-productos/catalog-public.json","utf8")) as Record<string,string>[];
 const bySku=new Map(fixture.map(row=>[row.SKU,row]));
 const mismatches=rows.flatMap(row=>{
  const expected=bySku.get(String(row.sku));
  if(!expected)return [{sku:row.sku,fields:["missing selected fixture"]}];
  const fields=[];
  if(row.slug!==expected.Slug)fields.push("slug");
  if(row.name!==expected.Producto)fields.push("name");
  if(row.category!==expected["Categoría"])fields.push("category");
  if(row.price_pyg!==Number(expected["Precio (₲)"]))fields.push("retail price");
  if(row.image_count!==(expected.Fotos || "").split("|").filter(Boolean).length)fields.push("image count");
  if(row.sale_mode!=="enquiry"||row.show_price!==1)fields.push("sale/price visibility");
  return fields.length?[{sku:row.sku,fields}]:[];
 });
 let sitemap:Record<string,unknown>;
 try{
  const response=await fetch("https://productos.com.py/sitemap.xml",{signal:AbortSignal.timeout(30000)});
  const xml=response.status===200?await response.text():"";
  const live=new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>(match[1] || "").replaceAll("&amp;","&")).filter(url=>url.includes("/producto/")).map(url=>new URL(url).pathname));
  const staged=new Set(rows.map(row=>"/producto/"+row.slug));
  sitemap={status:response.status,liveProducts:live.size,missingFromLive:[...staged].filter(slug=>!live.has(slug)),missingFromStaging:[...live].filter(slug=>!staged.has(slug))};
 }catch{sitemap={error:"Public sitemap unavailable; no further crawl attempted."};}
 await mkdir(output,{recursive:true});
 await writeFile(path.join(output,"CATALOG-AUDIT.json"),JSON.stringify({checkedAt:new Date().toISOString(),readOnly:true,counts,fixtureProducts:fixture.length,mismatches,sitemap,rows},null,2)+"\n");
 console.log(JSON.stringify({counts,mismatches:mismatches.length,sitemap,output}));
}finally{await proxy.dispose();}
