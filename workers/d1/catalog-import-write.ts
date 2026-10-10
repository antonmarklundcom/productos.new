import { randomUUID } from "node:crypto";
import type { D1Binding } from "./database";
import type { CatalogoProducto } from "../../src/domain/catalog-import";
import { normalizeDropiUrl } from "../../src/domain/catalog-import";
import { slugify } from "../../src/lib/slug";
import { parseRef } from "../../src/lib/imagenes-r2";

/** Each five-product D1 batch commits categories, catalog, costs and photos together. */
export async function writeD1CatalogBatch(binding:D1Binding,items:readonly CatalogoProducto[],overwriteStock=false){
  if(!items.length||items.length>5)throw new Error("Usá de uno a cinco productos por lote.");
  const statements:ReturnType<D1Binding["prepare"]>[]=[];
  const guard="catalog-import-"+randomUUID();
  const prepare=(text:string,values:(string|number|null)[]=[])=>binding.prepare(text).bind(...values);
  let variantsWritten=0;
  for(const p of items){
    const category=slugify(p.categoryName),dropi=normalizeDropiUrl(p.dropiUrl);
    if(!p.slug||!category||!p.variants.length||p.variants.length>50)throw new Error("Producto o variantes inválidos.");
    statements.push(prepare(`INSERT INTO categories(slug,name,position,is_active) VALUES(?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM categories),1) ON CONFLICT(slug) DO NOTHING`,[category,p.categoryName]));
    const updates=["name=excluded.name","description=excluded.description","category_id=excluded.category_id","brand=excluded.brand","iva_rate=excluded.iva_rate","is_active=1","published_at=COALESCE(products.published_at,CURRENT_TIMESTAMP)","updated_at=CURRENT_TIMESTAMP"];
    if(p.saleMode!==undefined)updates.push("sale_mode=excluded.sale_mode");
    if(p.showPrice!==undefined)updates.push("show_price=excluded.show_price");
    if(dropi!==undefined)updates.push("dropi_url=excluded.dropi_url");
    statements.push(prepare(`INSERT INTO products(slug,name,description,category_id,brand,iva_rate,sale_mode,show_price,dropi_url,is_active,published_at) VALUES(?,?,?,(SELECT id FROM categories WHERE slug=?),?,?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET ${updates.join(",")}`,[p.slug,p.name,p.description,category,p.brand,p.ivaRate,p.saleMode??"stock",p.showPrice===false?0:1,dropi??null]));
    for(const [position,v] of p.variants.entries()){
      for(const value of [v.pricePyg,v.onHand,v.compareAtPyg,v.unitCostPyg])if(value!=null&&(!Number.isSafeInteger(value)||value<0))throw new Error("Usá guaraníes enteros y stock no negativo.");
      if(!v.sku||(v.costSource?.length??0)>200)throw new Error("SKU o fuente de costo inválidos.");
      // A real CHECK within the batch aborts all writes if SKU ownership changed after preview.
      statements.push(prepare(`INSERT INTO counters(name,value) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM variants v JOIN products p ON p.id=v.product_id WHERE v.sku=? AND p.slug<>?) THEN 0 ELSE -1 END) ON CONFLICT(name) DO UPDATE SET value=excluded.value`,[guard,v.sku,p.slug]));
      statements.push(prepare(`INSERT INTO variants(product_id,sku,label,price_pyg,compare_at_pyg,on_hand,position,is_active) VALUES((SELECT id FROM products WHERE slug=?),?,?,?,?,?,?,1) ON CONFLICT(sku) DO UPDATE SET label=excluded.label,price_pyg=excluded.price_pyg,compare_at_pyg=excluded.compare_at_pyg,position=excluded.position,is_active=1,on_hand=${overwriteStock?"excluded.on_hand":"variants.on_hand"}`,[p.slug,v.sku,v.label,v.pricePyg,v.compareAtPyg,v.onHand,position]));
      if(v.unitCostPyg!==undefined)statements.push(prepare(`INSERT INTO supplier_offers(id,variant_id,unit_cost_pyg,source,source_type,product_url,is_confirmed,is_active,is_preferred) VALUES((SELECT s.id FROM supplier_offers s JOIN variants v ON v.id=s.variant_id WHERE v.sku=? AND s.is_preferred=1),(SELECT id FROM variants WHERE sku=?),?,?,?,?,1,1,1) ON CONFLICT(id) DO UPDATE SET unit_cost_pyg=excluded.unit_cost_pyg,source=excluded.source,updated_at=CURRENT_TIMESTAMP`,[v.sku,v.sku,v.unitCostPyg,v.costSource||null,dropi?"dropi":"other",dropi??null]));
      variantsWritten++;
    }
    if(p.fotos.length>10||p.fotos.some(ref=>!parseRef(ref)))throw new Error("Prepará las fotos en R2 antes de importarlas.");
    if(p.fotos.length)statements.push(prepare(`INSERT INTO product_images(product_id,cloudinary_id,alt,position) SELECT p.id,json_extract(j.value,'$.ref'),json_extract(j.value,'$.alt'),CAST(j.key AS INTEGER) FROM products p,json_each(?) j WHERE p.slug=? AND NOT EXISTS(SELECT 1 FROM product_images i WHERE i.product_id=p.id)`,[JSON.stringify(p.fotos.map((ref,i)=>({ref,alt:i?p.name+" — foto "+(i+1):p.name}))),p.slug]));
  }
  statements.push(prepare("DELETE FROM counters WHERE name=?",[guard]));
  if(statements.length>900)throw new Error("Demasiadas variantes para este lote.");
  const result=await binding.batch(statements);
  if(result.some((row:{success:boolean})=>!row.success))throw new Error("D1_CATALOG_BATCH_FAILED");
  return{variantsWritten};
}
