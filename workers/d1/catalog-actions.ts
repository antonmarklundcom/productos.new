import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getNativeDb, getD1Bindings } from "./database";
import { productImages, products } from "./schema";
import { buildCatalogImportPlan } from "./catalog-import-plan";
import { writeD1CatalogBatch } from "./catalog-import-write";
import { spreadsheetToCsvText } from "../../src/lib/spreadsheet";
import { requireStaffSession, adminActionError } from "../../src/lib/admin-guard";
import type { CatalogImportApplyResult } from "../../src/app/actions/admin-products";
import { boxesFor, keyFor, jpegKeyFor, formatRef, parseRef, sizeForBox } from "../../src/lib/imagenes-r2";
import { preparedImageDimensions } from "./image-validation";
import { storeGalleryFiles } from "./gallery-write";

function refresh(){revalidatePath("/admin/productos");revalidatePath("/","layout");}
export async function applyD1CatalogImport(data:FormData):Promise<CatalogImportApplyResult & {nextOffset?:number|null;totalProducts?:number}>{
  try{
    await requireStaffSession();
    const file=data.get("file");if(!(file instanceof File)||!file.size||file.size>800*1024)throw new Error("Elegí un archivo CSV o Excel de hasta 800 KB. Dividí las planillas más grandes.");
    const plan=await buildCatalogImportPlan(await spreadsheetToCsvText(file.name,Buffer.from(await file.arrayBuffer())));
    if(plan.errores.length)return{ok:false,errores:plan.errores};
    if(plan.advertencias?.length&&data.get("duplicateReview")!==JSON.stringify(plan.advertencias))return{ok:false,errores:["Revisá los posibles duplicados antes de confirmar."]};
    const offset=Number(data.get("batchOffset")??0);
    if(!Number.isSafeInteger(offset)||offset<0||offset>=plan.productos.length)throw new Error("Lote de importación inválido.");
    const selected=plan.productos.slice(offset,offset+5),db=getNativeDb(),bucket=getD1Bindings().IMAGES;
    let newPhotos=0;
    for(const p of selected){
      const [existing]=await db.select({id:products.id}).from(products).where(eq(products.slug,p.slug));
      const gallery=existing?await db.select({id:productImages.id}).from(productImages).where(eq(productImages.productId,existing.id)):[];
      if(gallery.length){p.fotos=[];continue;}
      for(const ref of p.fotos){
        const image=parseRef(ref);if(!image||!bucket)throw new Error("No se pudo verificar la foto en R2.");
        const keys=[...boxesFor(image.width,image.height).map(box=>keyFor(image.base,box)!),jpegKeyFor(image.base)!];
        for(const key of keys)if(!await bucket.head(key))throw new Error("Falta una foto en R2; este lote no se guardó.");
        newPhotos++;
      }
    }
    const written=await writeD1CatalogBatch(db.$client,selected,data.get("pisarStock")==="true");refresh();
    return{ok:true,productosNuevos:plan.productosNuevos,productosActualizar:plan.productosActualizar,variantesNuevas:plan.variantesNuevas,variantesActualizar:plan.variantesActualizar,categoriasNuevas:plan.categoriasNuevas,pisaStock:data.get("pisarStock")==="true",fotosNuevas:plan.fotosNuevas,variantesEscritas:written.variantsWritten,fotosSubidas:newPhotos,fotosOmitidas:0,fotosFallidas:[],nextOffset:offset+selected.length<plan.productos.length?offset+selected.length:null,totalProducts:plan.productos.length};
  }catch(error){return{ok:false,errores:[adminActionError("applyCatalogImport",error).error]};}
}

export async function uploadD1ProductImage(data:FormData){
  try{
    await requireStaffSession();const id=Number(data.get("productId")),db=getNativeDb(),bucket=getD1Bindings().IMAGES;
    if(!Number.isSafeInteger(id)||id<1||!bucket)throw new Error("Producto o almacenamiento de imágenes no disponible.");
    const [product]=await db.select({id:products.id,slug:products.slug}).from(products).where(eq(products.id,id));if(!product)throw new Error("El producto no existe.");
    const width=Number(data.get("imageWidth")),height=Number(data.get("imageHeight"));
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||Math.max(width,height)>1200)throw new Error("Prepará la foto antes de subirla.");
    const base=product.slug.slice(0,60).replace(/-+$/g,"")+"-"+crypto.randomUUID().replaceAll("-","").slice(0,10);
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
    await storeGalleryFiles(db.$client,bucket,id,ref,String(data.get("alt")??"").trim().slice(0,255)||null,files);
    refresh();return{ok:true as const};
  }catch(error){return adminActionError("uploadProductImage",error);}
}
export async function removeD1ProductImage(input:unknown){
  try{
    await requireStaffSession();const value=input as {productId?:number;imageId?:number};
    if(!Number.isSafeInteger(value?.productId)||!Number.isSafeInteger(value?.imageId)||value.productId!<1||value.imageId!<1)throw new Error("Imagen inválida.");
    await getNativeDb().delete(productImages).where(and(eq(productImages.id,value.imageId!),eq(productImages.productId,value.productId!)));
    refresh();return{ok:true as const};
  }catch(error){return adminActionError("removeProductImage",error);}
}
