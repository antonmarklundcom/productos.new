import assert from "node:assert/strict";
import {test} from "node:test";
import {getPlatformProxy} from "wrangler";
import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";
import {latestCategoryProductIds} from "../../workers/d1/latest-category-products.mjs";
import {d1StagingPlugin} from "../../workers/d1/build-plugin.mjs";

test("homepage latest selection keeps category order and excludes unpublished/inactive/unavailable products", {timeout:60000}, async()=>{
 const proxy=await getPlatformProxy({configPath:"workers/d1/local-settings-test.wrangler.jsonc",persist:false});
 try{
  const db=proxy.env.DB;
  for(const sql of [
   "CREATE TABLE categories (id INTEGER PRIMARY KEY, slug TEXT, is_active INTEGER)",
   "CREATE TABLE products (id INTEGER PRIMARY KEY, category_id INTEGER, published_at TEXT, is_active INTEGER)",
   "CREATE TABLE variants (id INTEGER PRIMARY KEY, product_id INTEGER, is_active INTEGER)",
   "INSERT INTO categories VALUES (1,'first',1),(2,'second',1),(3,'inactive',0),(4,'empty',1)",
   "INSERT INTO products VALUES (1,1,'2026-01-01',1),(2,1,'2026-02-01',1),(3,1,'2026-03-01',0),(4,1,NULL,1),(5,2,'2026-01-01',1),(6,3,'2026-04-01',1),(7,1,'2026-05-01',1)",
   "INSERT INTO variants VALUES (1,1,1),(2,2,1),(3,2,1),(4,3,1),(5,4,1),(6,5,1),(7,6,1),(8,7,0)"
  ]) await db.prepare(sql).run();
  assert.deepEqual(await latestCategoryProductIds(db,['second','empty','inactive','first']),[5,2]);
  assert.deepEqual(await latestCategoryProductIds(db,['first','second'],1),[2]);
  assert.deepEqual(await latestCategoryProductIds(db,[]),[]);
  assert.deepEqual(await latestCategoryProductIds(db,["first' OR 1=1 --"]),[]);
 }finally{await proxy.dispose();}
});
test("Workers middleware and homepage transformations fail on source drift and parse correctly",()=>{
 const root=path.resolve(import.meta.dirname,'../..'),plugin=d1StagingPlugin(root);
 for(const name of ['src/proxy.ts','src/app/page.tsx']){
  const file=path.join(root,name),code=plugin.transform(readFileSync(file,'utf8'),file).code;
  const result=ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext},reportDiagnostics:true});
  assert.equal(result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
  assert.throws(()=>plugin.transform('source changed',file),/source drift/);
  if(name.includes('proxy')) {assert.match(code,/catalogRendererCacheControl\(request\)/);assert.match(code,/startsWith\("\/producto\/"\)/);}
  else {assert.match(code,/getLatestCategoryProducts\(CATEGORIAS_INICIALES/);assert.doesNotMatch(code,/getCategoryProducts\(/);}
 }
});
