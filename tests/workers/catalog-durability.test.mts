import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync,readdirSync} from "node:fs";
import {getPlatformProxy} from "wrangler";
import {drizzle, type AnyD1Database} from "drizzle-orm/d1";
import {sql} from "drizzle-orm";
import {writeD1CatalogBatch} from "../../workers/d1/catalog-import-write";
import {importFingerprint,readImportRun,readBatchReceipt} from "../../workers/d1/catalog-durability";
import {writeD1Product,writeD1Variant} from "../../workers/d1/catalog-edit-write";
import type {CatalogoProducto} from "../../src/domain/catalog-import";
import {readDropiFreshness} from "../../workers/d1/supplier-costs";

test("native receipts survive lost acknowledgements, enforce input/actor identity and make stale saves atomic",{timeout:120000},async()=>{
 const platform=await getPlatformProxy<{DB:AnyD1Database}>({configPath:"workers/d1/local-settings-test.wrangler.jsonc",persist:false});
 try{
  const db=platform.env.DB;
  for(const name of readdirSync("workers/d1/migrations").filter(name=>name.endsWith(".sql")).sort())for(const statement of readFileSync("workers/d1/migrations/"+name,"utf8").split("--> statement-breakpoint"))if(statement.trim())await db.prepare(statement).run();
  const product:CatalogoProducto={slug:"durable-test",name:"Durable",categoryName:"Durability",description:null,brand:null,ivaRate:10,saleMode:"enquiry",showPrice:false,fotos:[],variants:[{sku:"DURABLE-1",label:"Única",pricePyg:12000,compareAtPyg:null,onHand:2,unitCostPyg:3400,costSource:"PRIVATE_NOT_IN_AUDIT"}]};
  const bytes=new TextEncoder().encode("synthetic fixture"),fingerprint=importFingerprint(bytes,false),id="11111111-1111-4111-8111-111111111111";
  await db.prepare("INSERT INTO catalog_import_runs(id,actor_id,fingerprint,total_products,next_offset) VALUES(?,1,?,1,0)").bind(id,fingerprint).run();
  const identity={id,actorId:1,fingerprint,offset:0,totalProducts:1,photosWritten:0};
  const lostAck={prepare:db.prepare.bind(db),batch:async(statements:Parameters<typeof db.batch>[0])=>{await db.batch(statements);throw new Error("TEST_LOST_ACK");}} as AnyD1Database;
  const first=await writeD1CatalogBatch(lostAck,[product],false,undefined,identity);
  assert.equal(first.replayed,true);assert.equal(first.variantsWritten,1);
  const before=JSON.stringify((await db.prepare("SELECT * FROM products").all()).results);
  const replay=await writeD1CatalogBatch(db,[product],false,undefined,identity);
  assert.equal(replay.replayed,true);assert.equal(JSON.stringify((await db.prepare("SELECT * FROM products").all()).results),before);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM catalog_audit WHERE record_type='product'").first("n"),1);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM variants").first("n"),1);
  assert.equal((await readImportRun(db,id,1,fingerprint))?.next_offset,1);
  assert.equal((await readBatchReceipt(db,identity))?.next_offset,1);
  await assert.rejects(readImportRun(db,id,2,fingerprint),/otro archivo, opciones o usuario/);
  await assert.rejects(readImportRun(db,id,1,importFingerprint(bytes,true)),/otro archivo, opciones o usuario/);
  await assert.rejects(readImportRun(db,id,1,importFingerprint(new TextEncoder().encode("changed"),false)),/otro archivo, opciones o usuario/);
  const p=await db.prepare("SELECT * FROM products WHERE slug='durable-test'").first<{id:number;revision:number;category_id:number}>();assert.ok(p);
  const input={productId:p.id,expectedRevision:p.revision,slug:"durable-test",name:"First editor",description:"",categoryId:p.category_id,brand:"",ivaRate:10,isActive:true,published:true,saleMode:"enquiry",showPrice:false};
  const outcomes=await Promise.allSettled([writeD1Product(db,1,input),writeD1Product(db,2,{...input,name:"Second editor"})]);
  assert.equal(outcomes.filter(outcome=>outcome.status==="fulfilled").length,1);
  const staleState=JSON.stringify((await db.prepare("SELECT * FROM products").all()).results);
  const variant=await db.prepare("SELECT id FROM variants WHERE sku='DURABLE-1'").first<{id:number}>();assert.ok(variant);
  await assert.rejects(writeD1Variant(db,2,{productId:p.id,expectedRevision:p.revision,variantId:variant.id,sku:"DURABLE-1",label:"Stale",pricePyg:1,isActive:true}),/borrador sigue aquí/);
  assert.equal(await db.prepare("SELECT price_pyg FROM variants WHERE id=?").bind(variant.id).first("price_pyg"),12000);
  assert.equal(JSON.stringify((await db.prepare("SELECT * FROM products").all()).results),staleState);
  const revision=await db.prepare("SELECT revision FROM products WHERE id=?").bind(p.id).first<number>("revision");assert.ok(revision);
  await writeD1Variant(db,1,{productId:p.id,expectedRevision:revision,variantId:variant.id,sku:"DURABLE-1",label:"Fresh",pricePyg:13000,isActive:true});
  assert.equal(await db.prepare("SELECT price_pyg FROM variants WHERE id=?").bind(variant.id).first("price_pyg"),13000);
  const audit=JSON.stringify((await db.prepare("SELECT * FROM catalog_audit").all()).results);
  assert.doesNotMatch(audit,/PRIVATE_NOT_IN_AUDIT|3400|synthetic fixture/);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM catalog_audit WHERE record_type='product'").first("n"),3);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM counters WHERE name LIKE 'revision-%'").first("n"),0);
 }finally{await platform.dispose();}
});

test("native publication guards manual and concurrent last-variant edits and allows intentional showcase", {timeout:120000}, async () => {
 const platform = await getPlatformProxy<{DB:AnyD1Database}>({configPath:"workers/d1/local-settings-test.wrangler.jsonc", persist:false});
 try {
  const db = platform.env.DB;
  for (const name of readdirSync("workers/d1/migrations").filter(name => name.endsWith(".sql")).sort())
   for (const statement of readFileSync("workers/d1/migrations/" + name, "utf8").split("--> statement-breakpoint"))
    if (statement.trim()) await db.prepare(statement).run();
  await db.prepare("INSERT INTO categories(id,slug,name,is_active) VALUES (1,'activa','Activa',1),(2,'oculta','Oculta',0)").run();

  const listing = {slug:"manual", name:"Manual", categoryId:1, ivaRate:10, isActive:true, published:true, saleMode:"enquiry"};
  await assert.rejects(writeD1Product(db,1,listing), {name:"AdminInputError", message:/activá una variante/});
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM products").first("n"), 0);

  const draft = await writeD1Product(db,1,{...listing,published:false});
  const productId = draft.productId;
  await assert.rejects(writeD1Product(db,1,{...listing,productId,expectedRevision:draft.revision}), /activá una variante/);
  const variant = {productId,label:"Única",pricePyg:1234,isActive:true};
  await writeD1Variant(db,1,{...variant,sku:"PUB-1",expectedRevision:1});
  await writeD1Variant(db,1,{...variant,sku:"PUB-2",expectedRevision:2});
  await writeD1Product(db,1,{...listing,productId,expectedRevision:3});

  const variants = await drizzle(db).all<{id:number;sku:string}>(
   sql`SELECT id,sku FROM variants WHERE product_id=${productId} ORDER BY id`);
  const outcomes = await Promise.allSettled(variants.map(({id,sku}) =>
   writeD1Variant(db,1,{...variant,variantId:id,sku,isActive:false,expectedRevision:4})));
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  const remaining = await db.prepare("SELECT id,sku FROM variants WHERE product_id=? AND is_active=1").bind(productId).first<{id:number;sku:string}>();
  assert.ok(remaining);
  await assert.rejects(writeD1Variant(db,1,{...variant,variantId:remaining.id,sku:remaining.sku,isActive:false,expectedRevision:5}),
   {name:"AdminInputError", message:/última variante activa/});
  assert.equal(await db.prepare("SELECT revision FROM products WHERE id=?").bind(productId).first("revision"), 5);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM variants WHERE product_id=? AND is_active=1").bind(productId).first("n"), 1);

  await writeD1Product(db,1,{...listing,productId,expectedRevision:5,published:false});
  await writeD1Variant(db,1,{...variant,variantId:remaining.id,sku:remaining.sku,isActive:false,expectedRevision:6});
  const showcase = await writeD1Product(db,1,{...listing,slug:"muestra",saleMode:"showcase"});
  await assert.rejects(writeD1Product(db,1,{...listing,slug:"muestra",productId:showcase.productId,expectedRevision:1}), /activá una variante/);
  const hiddenShowcase = await writeD1Product(db,1,{...listing,slug:"muestra-oculta",saleMode:"showcase",categoryId:2});
  assert.equal(await db.prepare("SELECT category_id FROM products WHERE id=?").bind(hiddenShowcase.productId).first("category_id"),2);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM counters WHERE name LIKE 'publication-%'").first("n"), 0);
 } finally { await platform.dispose(); }
});

test("Dropi review prioritizes unknown and stale exact offers, and imports cannot silently mark new costs fresh", {timeout:120000}, async () => {
 const platform = await getPlatformProxy<{DB:AnyD1Database}>({configPath:"workers/d1/local-settings-test.wrangler.jsonc", persist:false});
 try {
  const db = platform.env.DB;
  for (const name of readdirSync("workers/d1/migrations").filter(name => name.endsWith(".sql")).sort())
   for (const statement of readFileSync("workers/d1/migrations/" + name, "utf8").split("--> statement-breakpoint"))
    if (statement.trim()) await db.prepare(statement).run();
  await db.prepare("INSERT INTO categories(id,slug,name) VALUES (1,'prueba','Prueba')").run();
  await db.prepare("INSERT INTO products(id,slug,name,category_id) VALUES(1,'proveedor','Proveedor',1)").run();
  await db.prepare("INSERT INTO variants(id,product_id,sku,label,price_pyg,on_hand) VALUES(1,1,'SKU-EXACTO','Grande',10000,4)").run();
  await db.prepare(`INSERT INTO supplier_offers(id,variant_id,source_type,source,product_url,is_active,is_confirmed,is_preferred,checked_at,unit_cost_pyg,supplier_stock) VALUES
   (1,1,'dropi','Fuente uno','https://app.dropi.com.py/dashboard/product-details/123/producto',1,1,1,'2026-10-25 12:00:00',2000,0),
   (2,1,'dropi','Fuente dos','https://app.dropi.com.py/dashboard/product-details/456/producto',1,1,0,'2026-09-25 12:00:00',3000,NULL),
   (3,1,'dropi','Fuente tres','https://invalid.example/dashboard/product-details/789/producto',1,0,0,NULL,NULL,NULL),
   (4,1,'local','Excluida',NULL,1,1,0,NULL,1000,2),
   (5,1,'dropi','Inactiva',NULL,0,1,0,NULL,1000,2)`).run();

  const now = new Date("2026-11-06T12:00:00.000Z");
  const native = drizzle(db);
  const queue = await readDropiFreshness(native,1,now);
  assert.deepEqual(queue.rows.map(({offerId,sku,dropiId,freshness}) => [offerId,sku,dropiId,freshness]), [
   [3,"SKU-EXACTO",null,"unknown"], [2,"SKU-EXACTO","456","stale"], [1,"SKU-EXACTO","123","fresh"],
  ]);
  assert.equal(queue.rows[0]?.productUrl, null);
  assert.equal(queue.rows[2]?.supplierStock, 0);
  assert.equal(queue.hasNext,false);

  const input:CatalogoProducto = {slug:"proveedor",name:"Proveedor",categoryName:"Prueba",description:null,brand:null,ivaRate:10,
   dropiUrl:"https://app.dropi.com.py/dashboard/product-details/123/producto",fotos:[],
   variants:[{sku:"SKU-EXACTO",label:"Grande",pricePyg:10000,onHand:99,compareAtPyg:null,unitCostPyg:2500,costSource:"Fuente uno"}]};
  await writeD1CatalogBatch(db,[input]);
  const after = (await readDropiFreshness(native,1,now)).rows.find(offer => offer.offerId === 1);
  assert.equal(after?.freshness,"unknown");
  assert.equal(after?.costPyg,2500);
  assert.equal(after?.supplierStock,0);
  assert.equal(await db.prepare("SELECT on_hand FROM variants WHERE id=1").first("on_hand"),4);
 } finally { await platform.dispose(); }
});
