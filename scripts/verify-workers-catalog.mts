import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import type { AnyD1Database } from "drizzle-orm/d1";
import sharp from "sharp";
import { writeD1CatalogBatch } from "../workers/d1/catalog-import-write";
import { preparedImageDimensions } from "../workers/d1/image-validation";
import { storeGalleryFiles } from "../workers/d1/gallery-write";
import type { D1Binding, ImagesBucket } from "../workers/d1/database";
import type { CatalogoProducto } from "../src/domain/catalog-import";
const platform=await getPlatformProxy<{DB:AnyD1Database}>({configPath:"workers/d1/local-settings-test.wrangler.jsonc",persist:false});
try{
  const db=platform.env.DB;
  for(const name of ["0000_useful_mattie_franklin","0001_fancy_warhawk","0002_boring_roulette"]){
    for(const statement of readFileSync(`workers/d1/migrations/${name}.sql`,"utf8").split("--> statement-breakpoint"))if(statement.trim())await db.prepare(statement).run();
  }
  const product:CatalogoProducto={slug:"producto-test",name:"Producto de prueba",categoryName:"Prueba",description:null,brand:null,ivaRate:10,saleMode:"enquiry",showPrice:false,dropiUrl:"https://app.dropi.com.py/dashboard/product-details/123/prueba",fotos:["r2:p1/prueba-1234567890@800x600","r2:p1/prueba-abcdef1234@800x600"],variants:[{sku:"TEST-1",label:"Única",pricePyg:69000,compareAtPyg:null,onHand:8,unitCostPyg:18000,costSource:"Proveedor probado"}]};
  const read=async()=>({product:await db.prepare("SELECT * FROM products WHERE slug='producto-test'").first(),variant:await db.prepare("SELECT * FROM variants WHERE sku='TEST-1'").first(),images:(await db.prepare("SELECT * FROM product_images").all()).results,offers:(await db.prepare("SELECT * FROM supplier_offers").all()).results});
  await writeD1CatalogBatch(db,[product]);let state=await read();
  assert.equal(state.product?.sale_mode,"enquiry");assert.equal(state.product?.show_price,0);assert.equal(state.variant?.price_pyg,69000);assert.equal(state.images.length,2);assert.equal(state.offers.length,1);
  const update=structuredClone(product);update.saleMode=undefined;update.showPrice=undefined;update.dropiUrl=undefined;update.variants[0]!.pricePyg=71000;update.variants[0]!.onHand=99;
  await Promise.all([writeD1CatalogBatch(db,[update]),writeD1CatalogBatch(db,[update])]);state=await read();
  assert.equal(state.variant?.on_hand,8);assert.equal(state.variant?.price_pyg,71000);assert.equal(state.product?.sale_mode,"enquiry");assert.equal(state.product?.show_price,0);assert.equal(state.product?.dropi_url,product.dropiUrl);assert.equal(state.images.length,2);assert.equal(state.offers.length,1);
  await writeD1CatalogBatch(db,[update],true);assert.equal((await read()).variant?.on_hand,99);
  const alternative=await db.prepare("INSERT INTO supplier_offers(variant_id,unit_cost_pyg,source,is_confirmed,is_active,is_preferred) VALUES(?,21000,'Alternativa',1,1,0)").bind(state.variant!.id).run();assert.ok(alternative.success);
  await writeD1CatalogBatch(db,[update]);assert.equal((await read()).offers.length,2);
  const before=JSON.stringify(await read());
  const conflict=structuredClone(product);conflict.slug="intruso";conflict.categoryName="Nueva categoría abortada";
  await assert.rejects(writeD1CatalogBatch(db,[conflict]));assert.equal(JSON.stringify(await read()),before);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM products WHERE slug='intruso'").first("n"),0);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM categories WHERE name='Nueva categoría abortada'").first("n"),0);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM counters WHERE name LIKE 'catalog-import-%'").first("n"),0);
  const invalid=structuredClone(product);invalid.variants[0]!.pricePyg=12.5;await assert.rejects(writeD1CatalogBatch(db,[invalid]));assert.equal(JSON.stringify(await read()),before);
  await db.exec("CREATE TRIGGER test_catalog_abort BEFORE INSERT ON product_images BEGIN SELECT RAISE(ABORT, 'TEST_ABORT'); END");
  const failed=structuredClone(product);failed.slug="abortado";failed.variants[0]!.sku="TEST-ABORT";
  await assert.rejects(writeD1CatalogBatch(db,[failed]));assert.equal(await db.prepare("SELECT COUNT(*) n FROM products WHERE slug='abortado'").first("n"),0);
  for(const format of ["jpeg","webp"] as const){const bytes=await sharp({create:{width:480,height:320,channels:3,background:"white"}}).toFormat(format).toBuffer();assert.deepEqual(preparedImageDimensions(bytes,`image/${format}`),{width:480,height:320});}
  assert.equal(preparedImageDimensions(new TextEncoder().encode("<svg onload=alert(1)>"),"image/webp"),null);
  const objects=new Map<string,Uint8Array>([["existing-photo",new Uint8Array([1])]]);
  let failPut=false;
  const bucket:ImagesBucket={head:async key=>objects.has(key)?{}:null,put:async(key,bytes)=>{objects.set(key,bytes as Uint8Array);if(failPut&&key.endsWith("b"))throw new Error("TEST_LOST_R2_ACK");return{};},delete:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);}};
  const files=[{key:"test-a",bytes:new Uint8Array([1]),mime:"image/webp"},{key:"test-b",bytes:new Uint8Array([2]),mime:"image/jpeg"}];
  failPut=true;
  await assert.rejects(storeGalleryFiles(db,bucket,Number(state.product!.id),"test-ref",null,files));
  assert.deepEqual([...objects.keys()],["existing-photo"]);
  assert.equal((await read()).images.length,2);
  failPut=false;
  await assert.rejects(storeGalleryFiles(db,bucket,Number(state.product!.id),"test-ref",null,files));
  assert.ok(objects.has("test-a")&&objects.has("test-b"));
  assert.equal((await read()).images.length,2);
  await db.exec("DROP TRIGGER test_catalog_abort");
  // Simulate a successful D1 commit whose transport acknowledgement is lost.
  const lostAck={prepare:(query:string)=>({bind:(...values:unknown[])=>({run:async()=>{await db.prepare(query).bind(...values).run();throw new Error("TEST_LOST_D1_ACK");}})})} as unknown as D1Binding;
  await assert.rejects(storeGalleryFiles(lostAck,bucket,Number(state.product!.id),"test-ref",null,files));
  assert.equal((await read()).images.length,3);
  assert.ok(objects.has("test-a")&&objects.has("test-b")&&objects.has("existing-photo"));
  console.log("PASS: local D1 catalog atomicity, stock preservation, idempotency, cost alternatives, concurrency and encoded image validation");
}finally{await platform.dispose();}
