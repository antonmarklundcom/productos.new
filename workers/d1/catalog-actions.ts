import { catalogPlanFingerprint, loadCatalogPlan, getOrCreateCatalogPlan, applyStoredCatalogPlan } from "./catalog-staging";
import { mutateBulkCatalog, duplicateCatalogProduct } from "./native-bulk";
import { mutateGallery, mutationId, mutationImageBase } from "./gallery-mutations";
import { assertImportId } from "./catalog-durability";
import { writeD1Product, writeD1Variant } from "./catalog-edit-write";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getNativeDb, getD1Bindings } from "./database";
import { products } from "./schema";
import { spreadsheetToCsvText } from "../../src/lib/spreadsheet";
import { requireStaffSession, adminActionError } from "../../src/lib/admin-guard";
import { boxesFor, keyFor, jpegKeyFor, formatRef, sizeForBox } from "../../src/lib/imagenes-r2";
import { preparedImageDimensions } from "./image-validation";
import { storeGalleryFiles } from "./gallery-write";

function refresh(){revalidatePath("/admin/productos");revalidatePath("/","layout");}
export async function applyD1CatalogImport(data:FormData){
 try{
 const actor=await requireStaffSession(),file=data.get("file");
 if(!(file instanceof File)||!file.size||file.size>800*1024)throw new Error("Elegí un archivo CSV o Excel de hasta 800 KB.");
 const bytes=Buffer.from(await file.arrayBuffer()),overwrite=data.get("pisarStock")==="true",republish=data.get("republish")==="true",staged=data.get("staged")==="true",id=data.get("importId");assertImportId(id);
 const db=getNativeDb().$client,fingerprint=catalogPlanFingerprint(bytes,overwrite,republish,staged);
 const saved=await loadCatalogPlan(db,id,actor.userId,fingerprint);
 const row=saved??await getOrCreateCatalogPlan(db,id,actor.userId,fingerprint,await spreadsheetToCsvText(file.name,bytes),overwrite,republish,staged,String(data.get("duplicateReview")??""));
 const result=await applyStoredCatalogPlan(db,getD1Bindings().IMAGES,id,actor.userId,row,Number(data.get("batchOffset")??0));refresh();return result;
 }catch(error){return{ok:false as const,errores:[adminActionError("applyCatalogImport",error).error]};}
}
export async function publishD1CatalogImport(input:unknown){
 try{const actor=await requireStaffSession(),id=(input as {importId:string})?.importId;assertImportId(id);const db=getNativeDb().$client,row=await loadCatalogPlan(db,id,actor.userId);if(!row)throw new Error("No existe la importación.");const result=await applyStoredCatalogPlan(db,getD1Bindings().IMAGES,id,actor.userId,row,0,true);refresh();return result;}
 catch(error){return{ok:false as const,errores:[adminActionError("publishCatalogImport",error).error]};}
}
export async function bulkSetD1ProductsActive(input:unknown){try{const actor=await requireStaffSession();const result=await mutateBulkCatalog(getNativeDb().$client,actor.userId,input,"active");refresh();return{ok:true as const,...result};}catch(error){return adminActionError("bulkSetProductsActive",error);}}
export async function bulkMoveD1ProductsCategory(input:unknown){try{const actor=await requireStaffSession();const result=await mutateBulkCatalog(getNativeDb().$client,actor.userId,input,"category");refresh();return{ok:true as const,...result};}catch(error){return adminActionError("bulkMoveProductsCategory",error);}}
export async function duplicateD1Product(input:unknown){try{const actor=await requireStaffSession();const result=await duplicateCatalogProduct(getNativeDb().$client,actor.userId,input);refresh();return{ok:true as const,productId:result.productId!};}catch(error){return adminActionError("duplicateProductAction",error);}}

export async function uploadD1ProductImage(data:FormData){
  try{
    const actor=await requireStaffSession();const id=Number(data.get("productId")),db=getNativeDb(),bucket=getD1Bindings().IMAGES;
    if(!Number.isSafeInteger(id)||id<1||!bucket)throw new Error("Producto o almacenamiento de imágenes no disponible.");
    const [product]=await db.select({id:products.id,slug:products.slug}).from(products).where(eq(products.id,id));if(!product)throw new Error("El producto no existe.");
    const width=Number(data.get("imageWidth")),height=Number(data.get("imageHeight"));
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||Math.max(width,height)>1200)throw new Error("Prepará la foto antes de subirla.");
    const operationId=data.get("operationId");mutationId(operationId);
    const expectedRevision=Number(data.get("expectedRevision"));
    const base=mutationImageBase(product.slug,actor.userId,operationId);
    const ref=formatRef(base,width,height);if(!ref)throw new Error("Referencia de foto inválida.");
    const files:{key:string;bytes:Uint8Array;mime:string}[]=[];let total=0;
    const specs:[string,string,string,number][]=[...boxesFor(width,height).map(box=>["webp"+box,keyFor(base,box)!,"image/webp",box] as [string,string,string,number]),["jpeg",jpegKeyFor(base)!,"image/jpeg",Math.max(width,height)]];
    for(const [field,key,mime,box] of specs){
      const file=data.get(field);if(!(file instanceof File)||file.size>800*1024)throw new Error("Falta una versión de la foto o es demasiado pesada.");
      const bytes=new Uint8Array(await file.arrayBuffer());total+=bytes.length;
      const actual=preparedImageDimensions(bytes,mime),expected=sizeForBox(width,height,box)!;
      if(!actual||actual.width!==expected.width||actual.height!==expected.height)throw new Error("La foto preparada tiene un formato o tamaño inválido.");
      files.push({key,bytes,mime});
    }
    if(total>800*1024)throw new Error("La foto preparada es demasiado pesada.");
    const result=await storeGalleryFiles(db.$client,bucket,id,ref,String(data.get("alt")??"").trim().slice(0,255)||null,files,actor.userId,{operationId,expectedRevision});
    refresh();return{ok:true as const,...result};
  }catch(error){return adminActionError("uploadProductImage",error);}
}
async function galleryAction(input:unknown,kind:"alt"|"reorder"|"remove"|"restore"){
 try{const actor=await requireStaffSession();const result=await mutateGallery(getNativeDb().$client,actor.userId,{...(input as Parameters<typeof mutateGallery>[2]),kind});refresh();return{ok:true as const,...result};}
 catch(error){return adminActionError(kind+"ProductImage",error);}
}
export async function removeD1ProductImage(input:unknown){return galleryAction(input,"remove");}
export async function editD1ProductImage(input:unknown){return galleryAction(input,"alt");}
export async function reorderD1ProductImages(input:unknown){return galleryAction(input,"reorder");}
export async function restoreD1ProductImage(input:unknown){return galleryAction(input,"restore");}

export async function saveD1Product(input:unknown){
 try{const actor=await requireStaffSession();const result=await writeD1Product(getNativeDb().$client,actor.userId,input);refresh();return{ok:true as const,...result};}
 catch(error){return adminActionError("saveProduct",error);}
}
export async function saveD1ProductVariant(input:unknown){
 try{const actor=await requireStaffSession();const result=await writeD1Variant(getNativeDb().$client,actor.userId,input);refresh();return{ok:true as const,...result};}
 catch(error){return adminActionError("saveProductVariant",error);}
}


export async function listD1RemovedProductImages(input:unknown){
 try{const actor=await requireStaffSession();const id=Number((input as {productId:number})?.productId);if(!Number.isSafeInteger(id)||id<1)throw new Error("Producto inválido.");
 const rows=await getNativeDb().$client.prepare("SELECT id,alt FROM gallery_tombstones WHERE product_id=? AND actor_id=? AND restored_at IS NULL AND expires_at>CURRENT_TIMESTAMP ORDER BY expires_at DESC LIMIT 20").bind(id,actor.userId).all<{id:string;alt:string|null}>();return{ok:true as const,images:rows.results};
 }catch(error){return adminActionError("listRemovedImages",error);}
}
