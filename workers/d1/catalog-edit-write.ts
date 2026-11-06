import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { D1Binding } from "./database";
import { normalizeDropiUrl } from "../../src/domain/catalog-import";
import { catalogConflict, productAuditStatements, revisionGuard, type CatalogField } from "./catalog-durability";
import {
  hasActiveCatalogVariant,
  lastVariantMessage,
  publicationError,
  publicationGuard,

  publicationNeedsVariant,
} from "./catalog-publication.mjs";

const revision=z.number().int().positive().max(2147483646);
const productSchema=z.object({featuredPosition:z.number().int().min(0).max(1000000).optional(),productId:z.number().int().positive().optional(),expectedRevision:revision.optional(),slug:z.string().trim().max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),name:z.string().trim().min(2).max(200),description:z.string().trim().max(5000).optional(),categoryId:z.number().int().positive(),brand:z.string().trim().max(120).optional(),dropiUrl:z.string().trim().max(2048).nullable().optional(),ivaRate:z.union([z.literal(0),z.literal(5),z.literal(10)]),isActive:z.boolean(),published:z.boolean(),isFeatured:z.boolean().optional(),saleMode:z.enum(["enquiry","showcase"]).optional(),showPrice:z.boolean().optional()});
const variantSchema=z.object({productId:z.number().int().positive(),expectedRevision:revision,variantId:z.number().int().positive().optional(),sku:z.string().trim().min(1).max(64),label:z.string().trim().min(1).max(120),pricePyg:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),compareAtPyg:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),isActive:z.boolean(),reorderPoint:z.number().int().min(0).max(100000).nullable().optional()});
export async function writeD1Product(db:D1Binding,actorId:number,input:unknown){
 const p=productSchema.parse(input),dropi=normalizeDropiUrl(p.dropiUrl),id=p.productId;
 if(id!==undefined&&!p.expectedRevision)throw catalogConflict();
 const statements:ReturnType<D1Binding["prepare"]>[]=[];
 const prep=(text:string,...values:(string|number|null)[])=>db.prepare(text).bind(...values);
 if(id!==undefined)statements.push(revisionGuard(db,id,p.expectedRevision!));
 const publishingEnquiry = p.isActive && p.published && p.saleMode !== "showcase";
 if (publishingEnquiry && id === undefined) throw publicationError(publicationNeedsVariant);
 const missingVariant = `EXISTS (SELECT 1 FROM products p WHERE p.id=?
   AND COALESCE(?,p.sale_mode)<>'showcase' AND NOT ${hasActiveCatalogVariant})`;
 const publicationArgs = [id ?? null, p.saleMode ?? null];
 if (publishingEnquiry) statements.push(publicationGuard(db, missingVariant, publicationArgs));
 const writeIndex = statements.length;
 if(id===undefined)statements.push(prep("INSERT INTO products(slug,name,description,category_id,brand,dropi_url,iva_rate,is_active,is_featured,published_at,sale_mode,show_price) VALUES(?,?,?,?,?,?,?,?,?,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,?,?) RETURNING id",p.slug,p.name,p.description||null,p.categoryId,p.brand||null,dropi??null,p.ivaRate,+p.isActive,+(p.isFeatured??false),+p.published,p.saleMode??"enquiry",p.showPrice===false?0:1));
 else statements.push(prep("UPDATE products SET slug=?,name=?,description=?,category_id=?,brand=?,dropi_url=?,iva_rate=?,is_active=?,is_featured=COALESCE(?,is_featured),published_at=CASE WHEN ? THEN COALESCE(published_at,CURRENT_TIMESTAMP) ELSE NULL END,sale_mode=COALESCE(?,sale_mode),show_price=COALESCE(?,show_price),updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id",p.slug,p.name,p.description||null,p.categoryId,p.brand||null,dropi??null,p.ivaRate,+p.isActive,p.isFeatured===undefined?null:+p.isFeatured,+p.published,p.saleMode??null,p.showPrice===undefined?null:+p.showPrice,id));
 const fields:CatalogField[]=["slug","name","description","categoryId","brand","dropiUrl","ivaRate","isActive","published","isFeatured","saleMode","showPrice"];
 if(p.featuredPosition!==undefined)statements.push(prep("UPDATE products SET featured_position=? WHERE slug=?",p.featuredPosition,p.slug));
 if(id!==undefined)statements.push(...productAuditStatements(db,actorId,id,"save-product",fields));
 else statements.push(prep("INSERT INTO catalog_audit(id,actor_id,operation,record_type,record_id,revision,fields) SELECT ?,?,'create-product','product',id,revision,? FROM products WHERE slug=?",randomUUID(),actorId,JSON.stringify(fields),p.slug));
 try {
  const result = await db.batch<{id: number}>(statements);
  const row = result[writeIndex]?.results[0];
  if (!row) throw new Error("No se pudo guardar el producto.");
  return {productId: row.id, revision: id === undefined ? 1 : p.expectedRevision! + 1};
 } catch (error) {
  if (id !== undefined) {
   const row = await db.prepare("SELECT revision FROM products WHERE id=?").bind(id).first<{revision:number}>();
   if (row?.revision !== p.expectedRevision) throw catalogConflict();
  }
  if (publishingEnquiry && await prep("SELECT 1 WHERE " + missingVariant, ...publicationArgs).first())
   throw publicationError(publicationNeedsVariant);
  throw error;
 }
}
export async function writeD1Variant(db:D1Binding,actorId:number,input:unknown){
 const v=variantSchema.parse(input),prep=(text:string,...values:(string|number|null)[])=>db.prepare(text).bind(...values);
 const statements=[revisionGuard(db,v.productId,v.expectedRevision)];
 const disablingVariant = v.variantId !== undefined && !v.isActive;
 const lastVariant = `EXISTS (
  SELECT 1 FROM products p JOIN variants current ON current.product_id=p.id
  WHERE p.id=? AND current.id=? AND current.is_active=1 AND p.is_active=1
   AND p.published_at IS NOT NULL AND p.sale_mode<>'showcase'
   AND NOT EXISTS (SELECT 1 FROM variants other WHERE other.product_id=p.id AND other.is_active=1 AND other.id<>current.id)
 )`;
 const variantArgs = [v.productId, v.variantId ?? null];
 if (disablingVariant) statements.push(publicationGuard(db, lastVariant, variantArgs));
 if(v.variantId!==undefined)statements.push(prep("INSERT INTO counters(name,value) SELECT ?,-1 WHERE NOT EXISTS(SELECT 1 FROM variants WHERE id=? AND product_id=?)",randomUUID(),v.variantId,v.productId));
 if(v.variantId===undefined)statements.push(prep("INSERT INTO variants(product_id,sku,label,price_pyg,compare_at_pyg,is_active,reorder_point,on_hand) VALUES(?,?,?,?,?,?,?,0)",v.productId,v.sku,v.label,v.pricePyg,v.compareAtPyg??null,+v.isActive,v.reorderPoint??null));
 else statements.push(prep("UPDATE variants SET sku=?,label=?,price_pyg=?,compare_at_pyg=?,is_active=?,reorder_point=? WHERE id=? AND product_id=?",v.sku,v.label,v.pricePyg,v.compareAtPyg??null,+v.isActive,v.reorderPoint??null,v.variantId,v.productId));
 statements.push(...productAuditStatements(db,actorId,v.productId,"save-variant",["variants"]));
 try {
  await db.batch(statements);
 } catch (error) {
  const row = await db.prepare("SELECT revision FROM products WHERE id=?").bind(v.productId).first<{revision:number}>();
  if (row?.revision !== v.expectedRevision) throw catalogConflict();
  if (disablingVariant && await prep("SELECT 1 WHERE " + lastVariant, ...variantArgs).first())
   throw publicationError(lastVariantMessage);
  throw error;
 }
 return{revision:v.expectedRevision+1};
}
