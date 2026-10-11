import {getPlatformProxy} from 'wrangler';
import {withD1Database,getNativeDb,getDb} from '../workers/d1/database';
import {createCategory,updateCategory,moveCategory} from '../workers/d1/admin-categories';
import {saveD1SupplierOffer,readSupplierOffers} from '../workers/d1/supplier-costs';
import {rateLimit,resetRateLimitKey} from '../workers/d1/login-limit';
import {categories,products,variants,supplierOffers} from '../workers/d1/schema';
import {eq,sql} from 'drizzle-orm';
import {strict as assert} from 'node:assert';
if (!process.argv.includes('--allow-disposable-writes')) throw new Error('This integration test writes disposable staging records. Review the runbook, then pass --allow-disposable-writes explicitly.');
const proxy=await getPlatformProxy<{DB:Parameters<typeof withD1Database>[0]}>({configPath:'workers/d1/remote-test.wrangler.jsonc',persist:false});
let checks=0;
try{
 await withD1Database(proxy.env.DB,async()=>{
  const db=getNativeDb();
  const [counts]=await db.all<Record<string,number>>(sql`SELECT (SELECT COUNT(*) FROM products) products,(SELECT COUNT(*) FROM categories) categories,(SELECT COUNT(*) FROM product_images) images,(SELECT COUNT(*) FROM orders) orders,(SELECT COUNT(*) FROM users) users`);
  assert.equal(counts?.products,262);assert.equal(counts?.categories,9);assert.equal(counts?.images,821);assert.equal(counts?.orders,0);assert.equal(counts?.users,0);checks+=5;
  let called=false;
  assert.throws(()=>getDb().transaction(async()=>{called=true;}),/OPERATION_NOT_PORTED/);assert.equal(called,false);checks+=2;
  const originalPositions=await db.select({id:categories.id,position:categories.position}).from(categories);
  const slug='d1-readiness-test-'+Date.now();
  const cat=await createCategory({name:'Prueba D1',slug});
  let productId:number|undefined;
  try{
   await updateCategory({categoryId:cat.id,name:'Prueba D1 editada',slug});
   const [reread]=await db.select().from(categories).where(eq(categories.id,cat.id));assert.equal(reread?.name,'Prueba D1 editada');checks++;
   await moveCategory({categoryId:cat.id,direction:'up'});checks++;
   const [p]=await db.insert(products).values({name:'Prueba aislada',slug,categoryId:cat.id,saleMode:'enquiry',showPrice:false,dropiUrl:'https://app.dropi.com.py/dashboard/product-details/10067/cepillo-limpiador-con-dispenser-de-jabon'}).returning();assert.ok(p);productId=p.id;
   const [v]=await db.insert(variants).values({productId:p.id,sku:slug,label:'Prueba',pricePyg:69000}).returning();assert.ok(v);
   await assert.rejects(()=>db.update(variants).set({pricePyg:-1}).where(eq(variants.id,v.id)),(error:unknown)=>/constraint/i.test(String((error as {cause?:Error}).cause?.message)));checks++;
   await saveD1SupplierOffer(p.id,v.id,undefined,{source:'Prueba proveedor A',unitCostPyg:23000,sourceType:'other',isConfirmed:true,isActive:true,isPreferred:true});
   await saveD1SupplierOffer(p.id,v.id,undefined,{source:'Prueba proveedor B',unitCostPyg:18000,sourceType:'other',isConfirmed:true,isActive:true,isPreferred:true});
   const offers=await readSupplierOffers([v.id]);assert.equal(offers.length,2);assert.equal(offers.filter(o=>o.isPreferred).length,1);assert.equal(offers.find(o=>o.isPreferred)?.unitCostPyg,18000);checks+=3;
   await assert.rejects(()=>saveD1SupplierOffer(p.id,v.id,undefined,{source:'Prueba inválida',unitCostPyg:1,isConfirmed:false,isActive:true,isPreferred:true}),/confirmado/);checks++;
   // Force failure in the second statement: D1 must roll back the first write.
   await assert.rejects(()=>db.batch([db.update(supplierOffers).set({isPreferred:false}).where(eq(supplierOffers.variantId,v.id)),db.insert(supplierOffers).values({variantId:v.id,unitCostPyg:-1,source:'Falla deliberada'})]),(error:unknown)=>/constraint/i.test(String((error as {cause?:Error}).cause?.message)));
   assert.equal((await readSupplierOffers([v.id])).filter(o=>o.isPreferred).length,1);checks++;
   const key='readiness:'+slug;
   for(let i=0;i<2;i++)assert.equal((await rateLimit(key,{limit:2,windowMs:60000})).ok,true);
   assert.equal((await rateLimit(key,{limit:2,windowMs:60000})).ok,false);
   await resetRateLimitKey(key);assert.equal((await rateLimit(key,{limit:2,windowMs:60000})).ok,true);await resetRateLimitKey(key);checks+=4;
  }finally{
   if(productId)await db.delete(products).where(eq(products.id,productId));
   await db.delete(categories).where(eq(categories.id,cat.id));
   // Restore the copied category ordering after the temporary category move.
   const updates=originalPositions.map((original)=>db.update(categories).set({position:original.position}).where(eq(categories.id,original.id)));
   if(updates.length)await db.batch(updates as [typeof updates[number], ...typeof updates[number][]]);
  }
  return new Response(null);
 });
 console.log(JSON.stringify({remote_d1_checks_passed:checks,test_records_removed:true}));
}catch(error){console.error('D1 readiness test failed:',error instanceof Error?error.message.replace(/parameters:[\s\S]*/,'parameters: [redacted]'):'unknown');process.exitCode=1;}
finally{await proxy.dispose();}
