import {beforeEach,afterAll,describe,expect,it,vi} from "vitest";
import {eq} from "drizzle-orm";
import {getDb} from "@/db";
import {products,variants,catalogAudit} from "@/db/schema";
import {saveProduct,saveProductVariant} from "@/app/actions/admin-products";
import {upsertCatalogProducts} from "../../scripts/seed";
import {hasTestDb,resetTables,closeTestDb} from "../helpers/db";
import {createProduct,createVariant} from "../helpers/factories";
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/admin-guard",async original=>({...await original<typeof import("@/lib/admin-guard")>(),requireStaffSession:vi.fn(async()=>({userId:1,role:"staff",email:"synthetic@example.invalid"}))}));
describe.skipIf(!hasTestDb)("catalogue optimistic concurrency and actor audit",()=>{
 beforeEach(resetTables);afterAll(closeTestDb);
 it("one concurrent editor wins; stale product and variant actions leave all rows and audit unchanged",async()=>{
  const db=getDb(),id=await createProduct(),variantId=await createVariant({productId:id,onHand:2,pricePyg:12000});
  const [p]=await db.select().from(products).where(eq(products.id,id));
  const input={productId:id,expectedRevision:p!.revision,slug:p!.slug,name:"Editor one",description:"",categoryId:p!.categoryId,brand:"",ivaRate:10,isActive:true,published:true,saleMode:"enquiry",showPrice:false};
  const results=await Promise.all([saveProduct(input),saveProduct({...input,name:"Editor two"})]);
  expect(results.filter(result=>result.ok)).toHaveLength(1);
  const before=await db.select().from(products).where(eq(products.id,id));
  const auditBefore=await db.select().from(catalogAudit);
  expect(auditBefore).toHaveLength(1);expect(auditBefore[0]!.actorId).toBe(1);
  const stale=await saveProductVariant({productId:id,variantId,expectedRevision:p!.revision,sku:"UNUSED-STALE",label:"Stale",pricePyg:1,isActive:true});
  expect(stale.ok).toBe(false);
  expect(await db.select().from(products).where(eq(products.id,id))).toEqual(before);
  expect(await db.select().from(catalogAudit)).toEqual(auditBefore);
  const [v]=await db.select().from(variants).where(eq(variants.id,variantId));expect(v!.pricePyg).toBe(12000);
  expect((await saveProductVariant({productId:id,variantId,expectedRevision:before[0]!.revision,sku:v!.sku,label:"Fresh",pricePyg:13000,isActive:true})).ok).toBe(true);
  expect(await db.select().from(catalogAudit)).toHaveLength(2);
 });
 it("wrong or nonexistent variant IDs do not change data, revision or audit",async()=>{
  const db=getDb(),id=await createProduct(),otherId=await createProduct();
  const variantId=await createVariant({productId:otherId,onHand:2,pricePyg:12000});
  const beforeProducts=await db.select().from(products),beforeVariants=await db.select().from(variants),beforeAudit=await db.select().from(catalogAudit);
  const p=beforeProducts.find(row=>row.id===id)!;
  for(const invalidId of [variantId,2147483646]){
   const result=await saveProductVariant({productId:id,variantId:invalidId,expectedRevision:p.revision,sku:"UNUSED-INVALID",label:"Invalid",pricePyg:1,isActive:true});
   expect(result.ok).toBe(false);
   expect(await db.select().from(products)).toEqual(beforeProducts);
   expect(await db.select().from(variants)).toEqual(beforeVariants);
   expect(await db.select().from(catalogAudit)).toEqual(beforeAudit);
  }
 });
 it("panel imports increment the revision and atomically write metadata without private cost values",async()=>{
  const db=getDb(),id=await createProduct(),variantId=await createVariant({productId:id,onHand:2,pricePyg:12000});
  const [p]=await db.select().from(products).where(eq(products.id,id));const [v]=await db.select().from(variants).where(eq(variants.id,variantId));
  await upsertCatalogProducts([{slug:p!.slug,name:"Imported",description:null,categoryId:p!.categoryId,brand:null,ivaRate:10,saleMode:"enquiry",showPrice:false,variants:[{sku:v!.sku,label:v!.label,pricePyg:14000,compareAtPyg:null,onHand:99,unitCostPyg:3141,costSource:"PRIVATE_SOURCE"}]}],{actorId:1});
  const [updated]=await db.select().from(products).where(eq(products.id,id));expect(updated!.revision).toBe(p!.revision+1);
  const [updatedVariant]=await db.select().from(variants).where(eq(variants.id,variantId));expect(updatedVariant!.onHand).toBe(2);
  const audit=await db.select().from(catalogAudit);expect(audit).toHaveLength(1);expect(audit[0]!.actorId).toBe(1);expect(JSON.stringify(audit)).not.toMatch(/3141|PRIVATE_SOURCE/);
 });
});
