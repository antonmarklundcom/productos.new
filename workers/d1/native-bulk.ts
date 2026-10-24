import { createHash } from "node:crypto";
import type { D1Binding } from "./database";
import { mutationId } from "./gallery-mutations";
import { productAuditStatements, revisionGuard } from "./catalog-durability";

type Input = { operationId:string; productIds:number[]; expectedRevisions:Record<string,number>; isActive?:boolean; categoryId?:number };
type Result = { afectados:number; conflictos:number[]; productId?:number };
async function receipt(db:D1Binding,id:string,actor:number,fingerprint:string){
 const row=await db.prepare("SELECT actor_id,fingerprint,result_json FROM admin_mutation_receipts WHERE id=?").bind(id).first<{actor_id:number;fingerprint:string;result_json:string}>();
 if(row&&(row.actor_id!==actor||row.fingerprint!==fingerprint))throw new Error("Esta operación pertenece a otro usuario o contenido.");
 return row?JSON.parse(row.result_json) as Result:null;
}
function saveReceipt(db:D1Binding,id:string,actor:number,kind:string,fingerprint:string,result:Result){
 return db.prepare("INSERT INTO admin_mutation_receipts(id,actor_id,kind,fingerprint,result_json) VALUES(?,?,?,?,?)").bind(id,actor,kind,fingerprint,JSON.stringify(result));
}
export async function mutateBulkCatalog(db:D1Binding,actor:number,raw:unknown,kind:"active"|"category"):Promise<Result>{
 const input=raw as Input;mutationId(input?.operationId);
 if(!Array.isArray(input.productIds)||!input.productIds.length||input.productIds.length>50||new Set(input.productIds).size!==input.productIds.length||input.productIds.some(id=>!Number.isSafeInteger(id)||id<1))throw new Error("Elegí entre 1 y 50 productos.");
 if(kind==="active"&&typeof input.isActive!=="boolean")throw new Error("Visibilidad inválida.");
 if(kind==="category"&&(!Number.isSafeInteger(input.categoryId)||!await db.prepare("SELECT id FROM categories WHERE id=? AND is_active=1").bind(input.categoryId!).first()))throw new Error("La categoría no está disponible.");
 const fingerprint=createHash("sha256").update(JSON.stringify([kind,input.productIds,input.expectedRevisions,input.isActive,input.categoryId])).digest("hex");
 const replay=await receipt(db,input.operationId,actor,fingerprint);if(replay)return replay;
 const current:{id:number;revision:number}[]=(await db.prepare("SELECT id,revision FROM products WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(input.productIds)).all<{id:number;revision:number}>()).results;
 const versions=new Map(current.map(p=>[p.id,p.revision]));
 const conflictos=input.productIds.filter(id=>!Number.isSafeInteger(input.expectedRevisions?.[id])||versions.get(id)!==input.expectedRevisions[id]);
 const accepted=input.productIds.filter(id=>!conflictos.includes(id)),result={afectados:accepted.length,conflictos};
 const statements:ReturnType<D1Binding["prepare"]>[]=[];
 if(kind==="category")statements.push(db.prepare("INSERT INTO counters(name,value) SELECT ?,-1 WHERE NOT EXISTS(SELECT 1 FROM categories WHERE id=? AND is_active=1)").bind(input.operationId+"-category",input.categoryId!));
 for(const id of accepted){
  statements.push(revisionGuard(db,id,input.expectedRevisions[id]!));
  statements.push(kind==="active"?db.prepare("UPDATE products SET is_active=?,published_at=CASE WHEN ?=1 THEN COALESCE(published_at,CURRENT_TIMESTAMP) ELSE published_at END WHERE id=?").bind(input.isActive?1:0,input.isActive?1:0,id):db.prepare("UPDATE products SET category_id=? WHERE id=?").bind(input.categoryId!,id));
  statements.push(...productAuditStatements(db,actor,id,"bulk-"+kind,kind==="active"?["isActive","published"]:["categoryId"]));
 }
 statements.push(saveReceipt(db,input.operationId,actor,"bulk-"+kind,fingerprint,result));
 try{const rows=await db.batch(statements);if(rows.some((row:{success:boolean})=>!row.success))throw new Error("No se guardó el lote.");}
 catch(error){const saved=await receipt(db,input.operationId,actor,fingerprint);if(saved)return saved;throw error;}
 return result;
}
export async function duplicateCatalogProduct(db:D1Binding,actor:number,raw:unknown):Promise<Result>{
 const input=raw as {operationId:string;productId:number;expectedRevision:number};mutationId(input?.operationId);
 if(!Number.isSafeInteger(input.productId)||input.productId<1)throw new Error("Producto inválido.");
 const fingerprint=createHash("sha256").update(JSON.stringify(["duplicate",input.productId,input.expectedRevision])).digest("hex");
 const replay=await receipt(db,input.operationId,actor,fingerprint);if(replay)return replay;
 const suffix=createHash("sha256").update(actor+":"+input.operationId).digest("hex").slice(0,20),slug="borrador-"+suffix;
 // Deterministic identity permits safe receipt reconciliation after a lost acknowledgement.
 const statements=[revisionGuard(db,input.productId,input.expectedRevision),
 db.prepare("INSERT INTO products(slug,name,description,category_id,brand,iva_rate,sale_mode,show_price,is_active,is_featured,published_at) SELECT ?,name||' (copia)',description,category_id,brand,iva_rate,CASE WHEN sale_mode='stock' THEN 'enquiry' ELSE sale_mode END,show_price,0,0,NULL FROM products WHERE id=?").bind(slug,input.productId),
 db.prepare("INSERT INTO variants(product_id,sku,label,price_pyg,compare_at_pyg,on_hand,is_active,position) SELECT (SELECT id FROM products WHERE slug=?),?||'-'||id,label,price_pyg,compare_at_pyg,0,is_active,position FROM variants WHERE product_id=?").bind(slug,"copia-"+suffix,input.productId),
 db.prepare("INSERT INTO catalog_audit(id,actor_id,operation,record_type,record_id,revision,fields) SELECT ?,?,'duplicate','product',id,revision,'[\"name\",\"variants\",\"isActive\",\"published\"]' FROM products WHERE slug=?").bind(input.operationId,actor,slug),
 db.prepare("INSERT INTO admin_mutation_receipts(id,actor_id,product_id,kind,fingerprint,result_json) SELECT ?,?,id,'duplicate',?,json_object('afectados',1,'conflictos',json('[]'),'productId',id) FROM products WHERE slug=?").bind(input.operationId,actor,fingerprint,slug)];
 try{const rows=await db.batch(statements);if(rows.some((row:{success:boolean})=>!row.success))throw new Error("No se pudo duplicar.");}
 catch(error){const saved=await receipt(db,input.operationId,actor,fingerprint);if(saved)return saved;throw error;}
 return (await receipt(db,input.operationId,actor,fingerprint))!;
}
