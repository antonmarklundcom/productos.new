import { eq } from "drizzle-orm";
import { getNativeDb } from "./database";
import { categories, productImages, products, variants } from "./schema";
import { parseCatalogo } from "../../src/domain/catalog-import";
import type { CatalogImportPlan } from "../../src/domain/catalog-import-plan";
import { catalogDuplicateWarnings } from "../../src/lib/catalog-duplicates";
import { slugify } from "../../src/lib/slug";

/** Four bounded reads rather than thousands of SQL placeholders. */
export async function buildCatalogImportPlan(csvText:string):Promise<CatalogImportPlan>{
  const parsed=parseCatalogo(csvText),db=getNativeDb();
  if(parsed.productos.length>500)throw new Error("Dividí el archivo en planillas de hasta 500 productos.");
  const [categoryRows,productRows,variantRows,photos]=await Promise.all([
    db.select().from(categories),
    db.select({id:products.id,slug:products.slug,name:products.name,dropiUrl:products.dropiUrl,categoryName:categories.name}).from(products).innerJoin(categories,eq(products.categoryId,categories.id)),
    db.select({sku:variants.sku,productSlug:products.slug}).from(variants).innerJoin(products,eq(variants.productId,products.id)),
    db.select().from(productImages),
  ]);
  const categoryIdPorSlug=new Map<string,number>();
  for(const row of categoryRows){categoryIdPorSlug.set(row.slug,row.id);categoryIdPorSlug.set(slugify(row.name),row.id);}
  const owner=new Map(variantRows.map(row=>[row.sku,row.productSlug]));
  const existing=new Map(productRows.map(row=>[row.slug,row]));
  const refs=new Map<number,string[]>();
  for(const row of photos){const list=refs.get(row.productId)??[];list.push(row.cloudinaryId);refs.set(row.productId,list);}
  const newCategories=new Map<string,string>();let variantsNew=0,variantsUpdate=0,photosNew=0;
  for(const p of parsed.productos){
    const category=slugify(p.categoryName);if(!categoryIdPorSlug.has(category))newCategories.set(category,p.categoryName);
    for(const v of p.variants){if(owner.has(v.sku)){variantsUpdate++;if(owner.get(v.sku)!==p.slug)parsed.errores.push(`El SKU ${v.sku} pertenece a otro producto.`);}else variantsNew++;}
    if(!(refs.get(existing.get(p.slug)?.id??-1)?.length)){
      photosNew+=p.fotos.length;
      if(p.fotos.some(ref=>!ref.startsWith("r2:")))parsed.errores.push(`${p.name}: prepará las fotos en R2 o subilas desde el producto; no se descargan URLs externas durante la importación.`);
    }
  }
  const newProducts=parsed.productos.filter(p=>!existing.has(p.slug)).length;
  return{productos:parsed.productos,errores:parsed.errores,advertencias:catalogDuplicateWarnings(parsed.productos,productRows.map(p=>({...p,fotos:refs.get(p.id)??[]}))),productosNuevos:newProducts,productosActualizar:parsed.productos.length-newProducts,variantesNuevas:variantsNew,variantesActualizar:variantsUpdate,categoriasNuevas:[...newCategories.values()],categoriaIdPorSlug:categoryIdPorSlug,fotosNuevas:photosNew};
}
export async function ensureCatalogCategories():Promise<never>{throw new Error("Use the native atomic catalog batch.");}
export async function applyCatalogFotos():Promise<never>{throw new Error("Use the native atomic catalog batch.");}
