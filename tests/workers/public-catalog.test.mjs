import assert from "node:assert/strict";
import {test} from "node:test";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import path from "node:path";
import {getPlatformProxy} from "wrangler";
import {d1StagingPlugin} from "../../workers/d1/build-plugin.mjs";
import {catalogRead, categoryRead, featuredRead, productRead, relatedRead, latestRead} from "../../workers/d1/public-catalog-sql.mjs";
import {publicReadContext, cachedPublicRead} from "../../workers/d1/public-data-cache.mjs";
import {catalogResponse} from "../../workers/d1/public-response.mjs";

function fixture() {
 const sqlite = new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for (const name of ["0000_useful_mattie_franklin", "0001_fancy_warhawk", "0002_boring_roulette","0003_oval_masked_marvel"])
   sqlite.exec(readFileSync(`workers/d1/migrations/${name}.sql`, "utf8"));
 sqlite.exec("PRAGMA foreign_keys=ON");
 sqlite.exec(`INSERT INTO orders(id,order_number,access_token,customer_name,customer_phone,ship_city,ship_address,payment_method)
 VALUES (1,'TEST-1','test-1','Synthetic','0','Test','Test','transferencia'),
 (2,'TEST-2','test-2','Synthetic','0','Test','Test','transferencia'),
 (3,'TEST-3','test-3','Synthetic','0','Test','Test','transferencia');
 INSERT INTO categories(id,slug,name,position,is_active) VALUES (1,'tools','Tools',1,1),(2,'hidden','Hidden',0,0);
 INSERT INTO products(id,slug,name,category_id,brand,published_at,is_active,show_price,is_featured,dropi_url) VALUES
 (1,'first','First',1,'A','2026-01-01',1,1,0,'https://private-supplier.invalid'),
 (2,'masked','Masked',1,'B','2026-02-01',1,0,0,NULL),
 (3,'unpublished','Unpublished',1,NULL,NULL,1,1,0,NULL),
 (4,'disabled','Disabled',1,NULL,'2026-03-01',0,1,0,NULL),
 (5,'hidden-category','Hidden category',2,NULL,'2026-03-01',1,1,0,NULL),
 (6,'empty','Empty',1,'A','2026-04-01',1,1,0,NULL),
 (7,'held','Held',1,'A','2026-05-01',1,1,0,NULL);
 INSERT INTO variants(id,product_id,sku,label,price_pyg,compare_at_pyg,on_hand,position,is_active) VALUES
 (1,1,'SKU1','One',90000,100000,10,2,1),
 (2,1,'SKU2','Two',40000,NULL,3,1,1),
 (3,1,'INACTIVE','Hidden',1,NULL,90,0,0),
 (4,2,'MASK','One',70000,80000,1,1,1),
 (5,3,'DRAFT','One',10000,NULL,1,1,1),
 (6,4,'OFF','One',10000,NULL,1,1,1),
 (7,5,'CAT-OFF','One',10000,NULL,1,1,1),
 (8,7,'HELD','One',60000,NULL,1,1,1);
 INSERT INTO supplier_offers(variant_id,unit_cost_pyg,source,notes) VALUES (1,1000,'SECRET','PRIVATE');
 INSERT INTO product_images(product_id,cloudinary_id,position) VALUES (1,'last',2),(1,'first',1);
 INSERT INTO stock_reservations(order_id,variant_id,qty,state,expires_at) VALUES
 (1,1,2,'held','2099-01-01'),(1,1,9,'held','2000-01-01'),(1,2,9,'released','2099-01-01'),(1,8,1,'held','2099-01-01');
 INSERT INTO product_reviews(product_id,order_id,rating,body,author_name,status) VALUES
 (1,1,5,'Visible','Public','approved'),(1,2,4,'Visible 2','Public 2','approved'),(1,3,1,'PRIVATE','SECRET','pending');`);
 let batches = 0;
 const db = {
   prepare(sql) { const statement = {sql, args: [], bind(...args) {return {...statement, args};}}; return statement; },
   async batch(statements) {batches++;return statements.map(statement => ({success: true, results: sqlite.prepare(statement.sql).all(...statement.args)}));},
 };
 return {sqlite, db, batches: () => batches};
}
test("public batch preserves publication, price masking, images, held stock and approved ratings", async () => {
 const {db, sqlite, batches} = fixture();
 try {
   const result = await productRead(db, "first");
   assert.equal(batches(), 1);
   assert.deepEqual(result.product.images.map(image => image.cloudinaryId), ["first", "last"]);
   assert.deepEqual(result.product.variants.map(variant => [variant.sku, variant.available]), [["SKU2",3],["SKU1",8]]);
   assert.deepEqual(result.product.rating, {count: 2, average: 4.5});
   assert.equal(result.reviews.length, 2);
   assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE|unit.cost|costSource|dropi|orderId/);
   const masked = (await productRead(db,"masked")).product;
   assert.equal(masked.variants[0].pricePyg,0);assert.equal(masked.variants[0].compareAtPyg,null);
   for (const slug of ["unpublished","disabled","hidden-category","missing","first' OR 1=1 --"])
     assert.deepEqual(await productRead(db, slug), {product:null,reviews:[]});
   assert.deepEqual((await catalogRead(db)).map(product => product.slug), ["empty","first","held","masked"]);
 } finally {sqlite.close();}
});
test("category filters/count/pagination and sort retain hidden-price/null-last behavior in one batch", async () => {
 const {db, sqlite, batches} = fixture();
 try {
   const first = await categoryRead(db, {categorySlug:"tools",sort:"precio-asc",perPage:2});
   assert.equal(batches(),1);assert.equal(first.total,3);assert.equal(first.totalPages,2);
   assert.deepEqual(first.products.map(product => product.slug),["first","held"]);
   assert.deepEqual((await categoryRead(db,{categorySlug:"tools",sort:"precio-desc"})).products.map(product=>product.slug),["held","first","masked"]);
   assert.equal((await categoryRead(db,{categorySlug:"tools",minPricePyg:40000,maxPricePyg:40000})).total,1);
   assert.equal((await categoryRead(db,{categorySlug:"tools",brand:"A"})).total,2);
   assert.deepEqual((await categoryRead(db,{categorySlug:"tools",page:9})).products,[]);
   assert.equal((await categoryRead(db,{categorySlug:"hidden"})).total,0);
   assert.equal((await categoryRead(db,{categorySlug:"tools",brand:"A' OR 1=1 --"})).total,0);
   assert.deepEqual((await featuredRead(db)).map(product=>product.slug),["empty","first","held","masked"]);
   sqlite.exec("UPDATE products SET is_featured=1 WHERE id=2");
   assert.deepEqual((await featuredRead(db)).map(product=>product.slug),["masked"]);
   assert.deepEqual((await relatedRead(db,{productId:1,categorySlug:"tools",brand:"A"})).map(product=>product.slug),["masked"]);
   assert.deepEqual((await latestRead(db,["hidden","tools"])).map(row=>row.products[0].slug),["held"]);
 } finally {sqlite.close();}
});
function memoryCache() {
 const stores = new Map();
 return {open: async name => {
   if (!stores.has(name)) stores.set(name,new Map());
   const map = stores.get(name);
   return {match:async request=>map.get(request.url)?.clone(), put:async(request,response)=>map.set(request.url,response.clone())};
 }};
}
const env = {WORKERS_PUBLIC_CACHE_SECONDS:"60",CF_VERSION_METADATA:{id:"test-absolute-expiry"}};
test("HTML and RSC share DTOs, coalesce reads and never share cookie/admin/no-cache data", async () => {
 const storage = memoryCache(), pending = [], ctx = {waitUntil:promise=>pending.push(promise)};
 const origin = "https://cache-test.invalid";
 const context = headers=>publicReadContext(new Request(origin+"/producto/first",{headers}),env,ctx,storage);
 let time = Date.now(), calls=0;
 const load = async()=>{calls++;return {price:100};};
 const a=context({accept:"text/html"}), b=context({rsc:"1",accept:"text/x-component"});
 assert.equal(a.ttl,30); // At most 30 seconds at edge + 30 seconds client prefetch.
 await Promise.all([cachedPublicRead(a,"product:first",load,()=>time),cachedPublicRead(b,"product:first",load,()=>time)]);
 assert.equal(calls,1);assert.equal(a.expiresAt,b.expiresAt);await Promise.all(pending);
 time+=29000;
 const c=context({rsc:"1"});await cachedPublicRead(c,"product:first",load,()=>time);assert.equal(calls,1);
 assert.equal(c.expiresAt,a.expiresAt);
 time+=1001;await cachedPublicRead(context({rsc:"1"}),"product:first",load,()=>time);assert.equal(calls,2);
 for(const headers of [{cookie:"session=private"},{authorization:"Bearer private"},{"cache-control":"no-cache"}]) {
   const privateContext=context(headers);assert.equal(privateContext.enabled,false);
   await cachedPublicRead(privateContext,"product:first",load,()=>time);assert.equal(privateContext.expiresAt,Infinity);
 }
 assert.equal(calls,5);
 assert.equal(publicReadContext(new Request(origin+"/admin"),env,ctx,storage).enabled,false);
 assert.equal(publicReadContext(new Request(origin+"/producto/first"),{...env,WORKERS_PUBLIC_CACHE_SECONDS:"0"},ctx,storage).enabled,false);
 const version=context({});version.namespace+="-other-version";
 await cachedPublicRead(version,"product:first",load,()=>time);assert.equal(calls,6);
});
test("HTML cannot add a second TTL to old cached data, including expiry during streaming", async () => {
 const storage=memoryCache(), pending=[],ctx={waitUntil:promise=>pending.push(promise)};
 const req=new Request("https://html-expiry.invalid/producto/first",{headers:{accept:"text/html"}});
 const data={expiresAt:Date.now()+2200};
 const response=await catalogResponse(req,env,ctx,async()=>new Response("html",{headers:{"content-type":"text/html"}}),storage,data);
 assert.equal(response.headers.get("x-catalog-cache"),"MISS");
 assert.ok(Number(response.headers.get("cache-control").match(/s-maxage=(\d+)/)[1])<=2);
 await Promise.all(pending);
 const hit=await catalogResponse(req,env,ctx,async()=>{throw new Error("cache should hit");},storage,data);
 assert.equal(hit.headers.get("x-catalog-cache"),"HIT");
 assert.equal(hit.headers.get("x-catalog-expires-at"),String(data.expiresAt));
 const expired={expiresAt:Infinity};
 const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode("html"));expired.expiresAt=Date.now()-1;controller.close();}});
 const uncached=await catalogResponse(new Request(req.url+"-new",{headers:req.headers}),env,ctx,async()=>new Response(stream,{headers:{"content-type":"text/html"}}),storage,expired);
 assert.equal(uncached.headers.get("x-catalog-cache"),"BYPASS");assert.equal(uncached.headers.get("cache-control"),"private, no-store");
});

test("Workers public import adapters include search and preserve legacy shared readers", () => {
 const root=path.resolve(import.meta.dirname,"../.."), plugin=d1StagingPlugin(root);
 const native=path.resolve(root,"workers/d1/public-catalog.ts").replaceAll("\\","/");
 for(const relative of ["src/app/page.tsx","src/app/producto/[slug]/page.tsx","src/app/categoria/[slug]/page.tsx","src/app/buscar/page.tsx","src/components/site-header.tsx","src/components/site-footer.tsx"]) {
   const file=path.join(root,relative),original=readFileSync(file,"utf8"),code=plugin.transform(original,file)?.code ?? original;
   assert.ok(code.includes(native),relative+" must import the native public adapter");
   if(relative.includes("src/app"))assert.doesNotMatch(code,/from ["']@\/db\/queries["']/);
   if(relative.includes("/producto/"))assert.doesNotMatch(code,/from ["']@\/domain\/reviews["']/);
 }
 for(const relative of ["src/db/queries.ts"]) {
   const file=path.join(root,relative),original=readFileSync(file,"utf8"),code=plugin.transform(original,file)?.code ?? original;
   assert.ok(!code.includes(native),relative+" retains its original reader implementation");
 }
});

test("failed public readers do not cache successful-looking fallback HTML", async () => {
 const storage=memoryCache(),pending=[],ctx={waitUntil:promise=>pending.push(promise)};
 const req=new Request("https://failed-read.invalid/producto/first",{headers:{accept:"text/html"}});
 const context=publicReadContext(req,env,ctx,storage);
 await assert.rejects(cachedPublicRead(context,"failed-product",async()=>{throw new Error("synthetic failure");}));
 assert.equal(context.failed,true);
 const response=await catalogResponse(req,env,ctx,async()=>new Response("fallback",{headers:{"content-type":"text/html"}}),storage,context);
 assert.equal(response.headers.get("x-catalog-cache"),"BYPASS");assert.equal(response.headers.get("cache-control"),"private, no-store");
 assert.equal(pending.length,0);
});

function shuffledOrderingFixture() {
 const rows=Array.from({length:60},(_,index)=>{
   const id=(index*17)%60+1;
   return {id,slug:"shuffle-"+id,name:"Item "+String((id*19)%60).padStart(2,"0"),
     price:10000+((id*13)%17)*1000,showPrice:id%11!==0,publishedAt:"2026-01-"+String((id*7)%19+1).padStart(2,"0"),brand:id%2?"Brand A":null};
 });
 const statements=["INSERT INTO categories(id,slug,name,is_active) VALUES(1,'shuffle','Shuffle',1)"];
 for(const row of rows) {
   statements.push(`INSERT INTO products(id,slug,name,category_id,brand,published_at,is_active,show_price,is_featured)
     VALUES(${row.id},'${row.slug}','${row.name}',1,${row.brand?"'Brand A'":"NULL"},'${row.publishedAt}',1,${Number(row.showPrice)},${Number(row.id%3===0)})`);
   for(const position of [3,1,2]) {
     statements.push(`INSERT INTO variants(product_id,sku,label,price_pyg,on_hand,position,is_active)
       VALUES(${row.id},'SKU-${row.id}-${position}','Option ${position}',${row.price+(position-1)*1000},10,${position},1)`);
     statements.push(`INSERT INTO product_images(product_id,cloudinary_id,position) VALUES(${row.id},'image-${row.id}-${position}',${position})`);
   }
 }
 return {rows,statements};
}
function expectedCategoryOrder(rows,sort) {
 return [...rows].sort((a,b)=>{
   let result=0;
   if(sort.startsWith("precio-"))result=Number(!a.showPrice)-Number(!b.showPrice)||
     (a.showPrice&&b.showPrice?(a.price-b.price)*(sort==="precio-desc"?-1:1):0);
   else if(sort==="nuevos")result=b.publishedAt.localeCompare(a.publishedAt);
   else result=a.name.localeCompare(b.name);
   return result||a.id-b.id;
 });
}
async function assertShuffledOrder(db,rows) {
 for(const sort of ["relevancia","precio-asc","precio-desc","nuevos"]) {
   const expected=expectedCategoryOrder(rows,sort),actual=[];
   for(const page of [1,2]) {
     const result=await categoryRead(db,{categorySlug:"shuffle",sort,page,perPage:30});
     assert.equal(result.total,60);assert.equal(result.totalPages,2);
     assert.deepEqual(result.products.map(product=>product.slug),expected.slice((page-1)*30,page*30).map(row=>row.slug),sort+" page "+page);
     for(const product of result.products) {
       assert.deepEqual(product.variants.map(variant=>variant.sku),[1,2,3].map(position=>"SKU-"+product.id+"-"+position));
       assert.equal(product.image.cloudinaryId,"image-"+product.id+"-1");
     }
     actual.push(...result.products.map(product=>product.slug));
   }
   assert.deepEqual(actual,expected.map(row=>row.slug));
 }
 const detail=(await productRead(db,"shuffle-42")).product;
 assert.deepEqual(detail.images.map(image=>image.cloudinaryId),[1,2,3].map(position=>"image-42-"+position));
 const featured=await featuredRead(db,60);
 assert.deepEqual(featured.map(product=>product.slug),expectedCategoryOrder(rows.filter(row=>row.id%3===0),"nuevos").map(row=>row.slug));
 const catalog=await catalogRead(db,{categorySlug:"shuffle",limit:60});
 assert.deepEqual(catalog.map(product=>product.slug),expectedCategoryOrder(rows,"relevancia").map(row=>row.slug));
 const input=rows.find(row=>row.id===42),limit=4;
 const related=await relatedRead(db,{productId:42,categorySlug:"shuffle",brand:input.brand,pricePyg:input.price},limit);
 const expectedRelated=rows.filter(row=>row.id!==42).sort((a,b)=>{
   const brand=Number(a.brand!==input.brand)-Number(b.brand!==input.brand);
   const price=Number(a.showPrice)-Number(b.showPrice)||(a.showPrice&&b.showPrice?Math.abs(a.price-input.price)-Math.abs(b.price-input.price):0);
   return brand||price||a.name.localeCompare(b.name)||a.id-b.id;
 }).slice(0,limit);
 assert.deepEqual(related.map(product=>product.slug),expectedRelated.map(row=>row.slug));
}
test("explicit ordering survives shuffled 60-product input, price ties and two pages in SQLite",async()=>{
 const sqlite=new DatabaseSync(":memory:");
 try {
   for(const name of ["0000_useful_mattie_franklin","0001_fancy_warhawk","0002_boring_roulette","0003_oval_masked_marvel"])
     sqlite.exec(readFileSync(`workers/d1/migrations/${name}.sql`,"utf8"));
   const {rows,statements}=shuffledOrderingFixture();for(const statement of statements)sqlite.exec(statement);
   // Discourage relying on today's incidental table scan/subquery ordering.
   sqlite.exec("PRAGMA reverse_unordered_selects=ON");
   const db={prepare(sql){const statement={sql,args:[],bind(...args){return {...statement,args};}};return statement;},
     async batch(statements){return statements.map(statement=>({success:true,results:sqlite.prepare(statement.sql).all(...statement.args)}));}};
   await assertShuffledOrder(db,rows);
 } finally {sqlite.close();}
});
test("aggregate ORDER BY and ranked projection work on actual local D1 with 60 shuffled products",{timeout:120000},async()=>{
 const platform=await getPlatformProxy({configPath:"workers/d1/local-settings-test.wrangler.jsonc",persist:false});
 try {
   const db=platform.env.DB;
   for(const name of ["0000_useful_mattie_franklin","0001_fancy_warhawk","0002_boring_roulette","0003_oval_masked_marvel"])
     for(const statement of readFileSync(`workers/d1/migrations/${name}.sql`,"utf8").split("--> statement-breakpoint"))if(statement.trim())await db.prepare(statement).run();
   const {rows,statements}=shuffledOrderingFixture();
   // Keep each batch within the local D1 statement limit; never use remote bindings.
   for(let offset=0;offset<statements.length;offset+=80)await db.batch(statements.slice(offset,offset+80).map(sql=>db.prepare(sql)));
   await assertShuffledOrder(db,rows);
 } finally {await platform.dispose();}
});
