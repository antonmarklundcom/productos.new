import { randomUUID } from "node:crypto";
import { requireOwnerSession } from "../../src/lib/admin-guard";
import { catalogAudit } from "./schema";
import { and, asc, count, eq, isNotNull, sql } from "drizzle-orm";
import { getNativeDb } from "./database";
import { categories, products } from "./schema";
import { slugify } from "../../src/lib/slug";
import { DomainError } from "../../src/domain/errors";
import type { MessageKey, Params } from "../../src/i18n";
export class AdminCategoryError extends DomainError {
  constructor(code:MessageKey,params?:Params) {super(code,params);this.name="AdminCategoryError";}
}
export type CategoryPresentation = { description?:string|null; imageCloudinaryId?:string|null; imageAlt?:string|null };
export type AdminCategoryRow = typeof categories.$inferSelect & {productos:number;publicados:number};
function normalizar(input:{name:string;slug?:string|null}) {
  const name=input.name.trim().replace(/\s+/g," ");
  if(name.length<2)throw new AdminCategoryError("adminError.categoria.nombreCorto");
  if(name.length>120)throw new AdminCategoryError("adminError.categoria.nombreLargo");
  const slug=slugify(input.slug?.trim()||name);
  if(!slug)throw new AdminCategoryError("adminError.categoria.sinUrl");
  if(slug.length>120)throw new AdminCategoryError("adminError.categoria.slugLargo");
  return {name,slug};
}
function presentation(input:CategoryPresentation) {
  return Object.fromEntries(Object.entries(input).filter(([key,value])=>["description","imageCloudinaryId","imageAlt"].includes(key)&&value!==undefined).map(([key,value])=>[key,(value as string|null)?.trim()||null]));
}
export async function listAdminCategories():Promise<AdminCategoryRow[]> {
  const db=getNativeDb();
  const rows=await db.select({category:categories,productos:count(products.id),publicados:sql<number>`SUM(CASE WHEN ${products.isActive}=1 AND ${products.publishedAt} IS NOT NULL THEN 1 ELSE 0 END)`}).from(categories).leftJoin(products,eq(products.categoryId,categories.id)).groupBy(categories.id).orderBy(asc(categories.position),asc(categories.id));
  return rows.map(({category,productos,publicados})=>({...category,productos:Number(productos||0),publicados:Number(publicados||0)}));
}
export async function createCategory(input:{name:string;slug?:string|null}&CategoryPresentation):Promise<AdminCategoryRow> {
  const actor=await requireOwnerSession();
  const {name,slug}=normalizar(input);
  const db=getNativeDb();
  const [existing]=await db.select({id:categories.id}).from(categories).where(eq(categories.slug,slug));
  if(existing)throw new AdminCategoryError("adminError.categoria.urlRepetida",{slug});
  // One INSERT statement computes the end position atomically. Slug uniqueness
  // remains a database constraint, including concurrent creations.
  const [created]=await db.batch([db.insert(categories).values({name,slug,position:sql`(SELECT COALESCE(MAX(position),-1)+1 FROM categories)`,...presentation(input)}).returning(),db.insert(catalogAudit).values({id:randomUUID(),actorId:actor.userId,operation:"create-category",recordType:"category",recordId:sql`(SELECT id FROM categories WHERE slug=${slug})`,revision:1,fields:JSON.stringify(["name","slug","description","images"])} )]);
  const row=created[0];
  if(!row)throw new AdminCategoryError("adminError.categoria.noPude");
  return {...row,productos:0,publicados:0};
}
export async function updateCategory(input:{categoryId:number;name:string;slug?:string|null}&CategoryPresentation) {
  const actor=await requireOwnerSession();
  const {name,slug}=normalizar(input);
  const db=getNativeDb();
  const [changed]=await db.batch([db.update(categories).set({name,slug,...presentation(input)}).where(eq(categories.id,input.categoryId)).returning({id:categories.id}),...categoryEffects(db,actor.userId,input.categoryId,"save-category",["name","slug","description","images"])]);
  const updated=changed[0];
  if(!updated)throw new AdminCategoryError("adminError.categoria.noExiste");
}
export async function setCategoryActive(input:{categoryId:number;isActive:boolean}) {
  const actor=await requireOwnerSession(),db=getNativeDb();
  const [changed]=await db.batch([db.update(categories).set({isActive:input.isActive}).where(eq(categories.id,input.categoryId)).returning({id:categories.id}),...categoryEffects(db,actor.userId,input.categoryId,"set-category-active",["isActive"])]);
  const updated=changed[0];
  if(!updated)throw new AdminCategoryError("adminError.categoria.noExiste");
}
export async function moveCategory(input:{categoryId:number;direction:"up"|"down"}) {
  const actor=await requireOwnerSession(),db=getNativeDb();
  const delta=input.direction==="up"?-1:1;
  // A single statement reads and rewrites the complete ordering; there is no
  // async read/change gap or invented FOR UPDATE support.
  await db.batch([db.run(sql`WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position,id)-1 AS rank FROM categories
  ), moving AS (SELECT rank FROM ranked WHERE id=${input.categoryId})
  UPDATE categories SET position=(SELECT CASE
    WHEN ranked.rank=(SELECT rank FROM moving) AND EXISTS(SELECT 1 FROM ranked WHERE rank=(SELECT rank FROM moving)+${delta}) THEN ranked.rank+${delta}
    WHEN ranked.rank=(SELECT rank FROM moving)+${delta} THEN ranked.rank-${delta}
    ELSE ranked.rank END FROM ranked WHERE ranked.id=categories.id)`),...categoryEffects(db,actor.userId,input.categoryId,"move-category",["position"])]);
}
export async function categoriesForProductForm() {
  return getNativeDb().select({id:categories.id,name:categories.name,isActive:categories.isActive}).from(categories).orderBy(asc(categories.position),asc(categories.id));
}
export async function publishedCountForCategory(categoryId:number) {
  const [row]=await getNativeDb().select({n:count()}).from(products).where(and(eq(products.categoryId,categoryId),eq(products.isActive,true),isNotNull(products.publishedAt)));
  return Number(row?.n||0);
}
export async function setCategoryImage():Promise<never> {throw new Error("D1_STAGING_IMAGE_UPLOAD_DISABLED");}

function categoryEffects(db:ReturnType<typeof getNativeDb>,actorId:number,id:number,operation:string,fields:string[]){
 return [db.run(sql`INSERT INTO counters(name,value) SELECT ${randomUUID()},-1 WHERE NOT EXISTS(SELECT 1 FROM categories WHERE id=${id})`),db.update(products).set({revision:sql`${products.revision}+1`}).where(eq(products.categoryId,id)),db.insert(catalogAudit).values({id:randomUUID(),actorId,operation,recordType:"category",recordId:id,revision:sql`(SELECT COALESCE(MAX(revision),0)+1 FROM catalog_audit WHERE record_type='category' AND record_id=${id})`,fields:JSON.stringify(fields)})] as const;
}
