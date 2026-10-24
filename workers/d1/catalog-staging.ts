import { createHash, randomUUID } from "node:crypto";
import type { D1Binding } from "./database";
import type { CatalogImportPlan } from "../../src/domain/catalog-import-plan";
import type { CatalogoProducto } from "../../src/domain/catalog-import";
import { buildCatalogImportPlan } from "./catalog-import-plan";
import { writeD1CatalogBatch } from "./catalog-import-write";
import { readImportRun, receiptSummary, assertImportId, revisionGuard, readBatchReceipt, importFingerprint } from "./catalog-durability";
import { catalogCategoryAliases } from "./catalog-category-identity";
import { boxesFor, keyFor, jpegKeyFor, parseRef } from "../../src/lib/imagenes-r2";
import type { ImagesBucket } from "./database";

type Stored = Omit<CatalogImportPlan,"categoriaIdPorSlug"> & {categoryIds:[string,number][];baseline:{slug:string;id:number|null;revision:number|null}[];overwrite:boolean;republish:boolean};
type PlanRow={actor_id:number;fingerprint:string;plan_json:string;mode:"direct"|"staged";status:string};
export function catalogPlanFingerprint(bytes:Uint8Array,overwrite:boolean,republish:boolean,staged:boolean){
 if(!republish&&!staged)return importFingerprint(bytes,overwrite);
 return createHash("sha256").update("catalog-v2:"+JSON.stringify([overwrite,republish,staged])+":").update(bytes).digest("hex");
}
export async function loadCatalogPlan(db:D1Binding,id:string,actor:number,fingerprint?:string):Promise<(PlanRow & {plan:Stored})|null>{
 assertImportId(id);
 const row=await db.prepare("SELECT actor_id,fingerprint,plan_json,mode,status FROM catalog_import_plans WHERE import_id=?").bind(id).first<PlanRow>();
 if(row&&(row.actor_id!==actor||(fingerprint!==undefined&&row.fingerprint!==fingerprint)))throw new Error("Esta importación pertenece a otro archivo, opciones o usuario.");
 return row?{...row,plan:JSON.parse(row.plan_json) as Stored}:null;
}
export async function getOrCreateCatalogPlan(db:D1Binding,id:string,actor:number,fingerprint:string,csv:string,overwrite:boolean,republish:boolean,staged:boolean,review:string|null){
 const saved=await loadCatalogPlan(db,id,actor,fingerprint);if(saved)return saved;
 const existingRun=await readImportRun(db,id,actor,fingerprint);
 const plan=await buildCatalogImportPlan(csv);
 if(plan.errores.length)throw new Error(plan.errores.join("\n"));
 if(!plan.productos.length)throw new Error("La planilla no contiene productos.");
 if(existingRun&&existingRun.total_products!==plan.productos.length)throw new Error("La importación guardada no coincide con esta planilla.");
 if(plan.advertencias?.length&&review!==JSON.stringify(plan.advertencias))throw new Error("Revisá los posibles duplicados antes de confirmar.");
 if(staged&&(plan.productos.length>50||plan.productos.reduce((n,p)=>n+p.variants.length,0)>250))throw new Error("La publicación completa admite hasta 50 productos y 250 variantes. Dividí la planilla o usá la importación por lotes.");
 const statementBound=6+plan.productos.reduce((n,p)=>n+7+p.variants.reduce((m,v)=>m+2+(v.unitCostPyg!==undefined?1:0),0),0);
 if(staged&&statementBound>900)throw new Error("Esta planilla excede el límite de publicación atómica por sus variantes, costos o fotos. Dividila en archivos más pequeños.");
 const rows:{id:number;slug:string;revision:number}[]=(await db.prepare("SELECT id,slug,revision FROM products WHERE slug IN (SELECT value FROM json_each(?))").bind(JSON.stringify(plan.productos.map(p=>p.slug))).all<{id:number;slug:string;revision:number}>()).results;
 const stored:Stored={...plan,categoryIds:[...plan.categoriaIdPorSlug],baseline:plan.productos.map(p=>{const row=rows.find(r=>r.slug===p.slug);return{slug:p.slug,id:row?.id??null,revision:row?.revision??null};}),overwrite,republish};
 const summary=JSON.stringify({productosNuevos:plan.productosNuevos,productosActualizar:plan.productosActualizar,variantesNuevas:plan.variantesNuevas,variantesActualizar:plan.variantesActualizar,fotosNuevas:plan.fotosNuevas});
 await db.batch([db.prepare("INSERT INTO catalog_import_plans(import_id,actor_id,fingerprint,plan_json,mode) VALUES(?,?,?,?,?) ON CONFLICT(import_id) DO NOTHING").bind(id,actor,fingerprint,JSON.stringify(stored),staged?"staged":"direct"),db.prepare("INSERT INTO catalog_import_runs(id,actor_id,fingerprint,total_products,next_offset,summary_json) VALUES(?,?,?,?,0,?) ON CONFLICT(id) DO NOTHING").bind(id,actor,fingerprint,plan.productos.length,summary)]);
 return (await loadCatalogPlan(db,id,actor,fingerprint))!;
}
export async function verifyCatalogPhotos(db:D1Binding,bucket:ImagesBucket|undefined,items:CatalogoProducto[]){
 let photos=0;
 for(const p of items){
 const existing=await db.prepare("SELECT 1 FROM product_images i JOIN products p ON p.id=i.product_id WHERE p.slug=? LIMIT 1").bind(p.slug).first();
 if(existing){p.fotos=[];continue;}
 for(const ref of p.fotos){const image=parseRef(ref);if(!image||!bucket)throw new Error("No se pudo verificar la foto en R2.");
 for(const key of [...boxesFor(image.width,image.height).map(box=>keyFor(image.base,box)!),jpegKeyFor(image.base)!])if(!await bucket.head(key))throw new Error("Falta una foto en R2; no se guardó la importación.");photos++;}
 }return photos;
}
export async function applyStoredCatalogPlan(db:D1Binding,bucket:ImagesBucket|undefined,id:string,actor:number,row:NonNullable<Awaited<ReturnType<typeof loadCatalogPlan>>>,offset:number,publish=false){
 const plan=row.plan,run=await readImportRun(db,id,actor,row.fingerprint);if(!run)throw new Error("No existe la importación.");
 const total=plan.productos.length;
 if(!Number.isSafeInteger(offset)||offset<0||offset>=total||offset%5!==0)throw new Error("Lote inválido.");
 const summary=receiptSummary(run.summary_json);
 if(row.mode==="staged"&&!publish){
 const selected=plan.productos.slice(offset,offset+5);await verifyCatalogPhotos(db,bucket,structuredClone(selected));
 await db.prepare("INSERT INTO catalog_import_stages(id,import_id,offset,payload_json) VALUES(?,?,?,?) ON CONFLICT(import_id,offset) DO NOTHING").bind(id+":"+offset,id,offset,JSON.stringify(selected)).run();
 const stages:{offset:number}[]=(await db.prepare("SELECT offset FROM catalog_import_stages WHERE import_id=? ORDER BY offset").bind(id).all<{offset:number}>()).results;
 const ready=Array.from({length:Math.ceil(total/5)},(_,i)=>i*5).every(n=>stages.some(s=>s.offset===n));
 if(ready)await db.prepare("UPDATE catalog_import_plans SET status='ready' WHERE import_id=? AND status='applying'").bind(id).run();
 return{ok:true as const,...summary,pisaStock:plan.overwrite,variantesEscritas:0,fotosSubidas:0,fotosOmitidas:0,fotosFallidas:[],nextOffset:offset+selected.length<total?offset+selected.length:null,totalProducts:total,stagedReady:ready,importId:id};
 }
 if(publish&&row.mode!=="staged")throw new Error("Esta importación no usa publicación completa.");
 if(publish&&row.status!=="ready"&&row.status!=="published")throw new Error("Faltan lotes por preparar.");
 const replay=await readBatchReceipt(db,{id,actorId:actor,fingerprint:row.fingerprint,offset:publish?0:offset,totalProducts:total,photosWritten:0});
 if(replay)return{ok:true as const,...summary,pisaStock:plan.overwrite,variantesEscritas:replay.variants_written,fotosSubidas:replay.photos_written,fotosOmitidas:0,fotosFallidas:[],nextOffset:replay.next_offset<total?replay.next_offset:null,totalProducts:total,stagedReady:false,importId:id};
 const selected=structuredClone(publish?plan.productos:plan.productos.slice(offset,offset+5)),photos=await verifyCatalogPhotos(db,bucket,selected);
 const guards:ReturnType<D1Binding["prepare"]>[]=[];
 // A plan cannot overwrite changes made since its review; direct batches guard only their own records.
 for(const p of selected){const baseline=plan.baseline.find((b:Stored["baseline"][number])=>b.slug===p.slug)!;
 if(baseline.id!==null)guards.push(revisionGuard(db,baseline.id,baseline.revision!));
 else guards.push(db.prepare("INSERT INTO counters(name,value) SELECT ?,-1 WHERE EXISTS(SELECT 1 FROM products WHERE slug=?)").bind("import-new-"+randomUUID(),p.slug));
 }
 const categories=(await db.prepare("SELECT id,slug,name FROM categories ORDER BY id").all<{id:number;slug:string;name:string}>()).results;
 const categoryIds:Map<string,number>=publish?new Map<string,number>(plan.categoryIds):catalogCategoryAliases(categories).ids;
 const written=await writeD1CatalogBatch(db,selected,plan.overwrite,categoryIds,{id,actorId:actor,fingerprint:row.fingerprint,offset:publish?0:offset,totalProducts:total,photosWritten:photos},plan.republish,{maxBatchProducts:publish?50:5,guardStatements:guards,extraStatements:publish?[db.prepare("UPDATE catalog_import_plans SET status='published' WHERE import_id=?").bind(id)]:[]});
 return{ok:true as const,...summary,pisaStock:plan.overwrite,variantesEscritas:written.variantsWritten,fotosSubidas:written.photosWritten,fotosOmitidas:0,fotosFallidas:[],nextOffset:publish||offset+selected.length>=total?null:offset+selected.length,totalProducts:total,stagedReady:false,importId:id};
}
