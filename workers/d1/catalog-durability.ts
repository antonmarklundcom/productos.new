import { createHash, randomUUID } from "node:crypto";
import type { D1Binding } from "./database";

export const CATALOG_CONFLICT = "El producto cambió desde que abriste el formulario. Tu borrador sigue aquí: copiá tus cambios y recargá la ficha antes de guardar.";
export function catalogConflict(){const error=new Error(CATALOG_CONFLICT);error.name="AdminInputError";return error;}
export const AUDIT_FIELDS = ["name","slug","description","categoryId","brand","ivaRate","isActive","isFeatured","published","saleMode","showPrice","dropiUrl","variants","images","supplierOffers"] as const;
export type CatalogField = typeof AUDIT_FIELDS[number];
export type ImportIdentity = { id:string; actorId:number; fingerprint:string; offset:number; totalProducts:number; photosWritten:number };
export type BatchReceipt = { next_offset:number; variants_written:number; photos_written:number };
export const importFingerprint = (bytes:Uint8Array, overwriteStock:boolean) => createHash("sha256").update("catalog-v1:"+String(overwriteStock)+":").update(bytes).digest("hex");
export function assertImportId(value:unknown): asserts value is string {
  if(typeof value!=="string"||! /^[a-f0-9-]{36}$/.test(value))throw new Error("Identidad de importación inválida; revisá la planilla nuevamente.");
}
export async function readImportRun(db:D1Binding,id:string,actorId:number,fingerprint:string){
 const row=await db.prepare("SELECT actor_id,fingerprint,next_offset,total_products,summary_json FROM catalog_import_runs WHERE id=?").bind(id).first<{actor_id:number;fingerprint:string;next_offset:number;total_products:number;summary_json:string}>();
 if(row&&(row.actor_id!==actorId||row.fingerprint!==fingerprint))throw new Error("Esta importación pertenece a otro archivo, opciones o usuario. Iniciá una importación nueva.");
 return row;
}
export async function readBatchReceipt(db:D1Binding,identity:ImportIdentity){
 await readImportRun(db,identity.id,identity.actorId,identity.fingerprint);
 return db.prepare("SELECT next_offset,variants_written,photos_written FROM catalog_import_receipts WHERE import_id=? AND offset=? AND actor_id=?").bind(identity.id,identity.offset,identity.actorId).first<BatchReceipt>();
}
export function revisionGuard(db:D1Binding,productId:number,expectedRevision:number){
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw catalogConflict();
 return db.prepare("INSERT INTO counters(name,value) SELECT ?,-1 WHERE NOT EXISTS(SELECT 1 FROM products WHERE id=? AND revision=?)").bind("revision-"+randomUUID(),productId,expectedRevision);
}
/** Caller places this together with its catalogue write in a single D1 batch. */
export function productAuditStatements(db:D1Binding,actorId:number,productId:number,operation:string,fields:readonly CatalogField[],eventId=randomUUID()){
 if(!Number.isSafeInteger(actorId)||actorId<1||fields.some(field=>!AUDIT_FIELDS.includes(field)))throw new Error("CATALOG_AUDIT_INVALID");
 return [db.prepare("UPDATE products SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(productId),
 db.prepare("INSERT INTO catalog_audit(id,actor_id,operation,record_type,record_id,revision,fields) SELECT ?,?,?,'product',id,revision,? FROM products WHERE id=?").bind(eventId,actorId,operation,JSON.stringify([...new Set(fields)]),productId)];
}

export type ImportSummaryMetadata={productosNuevos:number;productosActualizar:number;variantesNuevas:number;variantesActualizar:number;fotosNuevas:number};
export function receiptSummary(summary:string){
 const value=JSON.parse(summary) as ImportSummaryMetadata;
 for(const key of ["productosNuevos","productosActualizar","variantesNuevas","variantesActualizar","fotosNuevas"] as const)if(!Number.isSafeInteger(value[key])||value[key]<0)throw new Error("CATALOG_RECEIPT_SUMMARY_INVALID");
 return{productosNuevos:value.productosNuevos,productosActualizar:value.productosActualizar,variantesNuevas:value.variantesNuevas,variantesActualizar:value.variantesActualizar,fotosNuevas:value.fotosNuevas,categoriasNuevas:[] as string[]};
}
