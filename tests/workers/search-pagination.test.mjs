import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import ts from "typescript";
import * as orm from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { tsImport } from "tsx/esm/api";
import { d1StagingPlugin } from "../../workers/d1/build-plugin.mjs";

// Run the actual adapted reader against SQLite, without external services.
// Only unrelated reservation/review readers are stubbed (covered separately).
test("41 matching products remain reachable with stable publication-safe search pages", async () => {
 const schema = await tsImport("../../workers/d1/schema.ts", import.meta.url);
 const filename=path.resolve("src/db/queries.ts");
 const source=readFileSync(filename,"utf8");
 const adapted=d1StagingPlugin(process.cwd()).transform(source,filename).code;
 assert.ok(!adapted.includes("MATCH("), "D1 search translation must cover both readers");
 let code=ts.transpileModule(adapted,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 code=code.replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm, "").replace(/^export /gm, "");
 const names=[...Object.keys(orm),...Object.keys(schema),"getDb","heldQtyMap","getRatingSummaries"];
 const values=[...Object.values(orm),...Object.values(schema),()=>{throw Error("unexpected DB");},async()=>new Map(),async()=>new Map()];
 const {searchProductsPage,searchProducts}=new Function(...names,code+";return {searchProductsPage,searchProducts};")(...values);
 const sqlite=new DatabaseSync(":memory:");
 try {
  for(const migration of ["0000_useful_mattie_franklin","0001_fancy_warhawk","0002_boring_roulette","0003_oval_masked_marvel"]) sqlite.exec(readFileSync("workers/d1/migrations/"+migration+".sql","utf8"));
  sqlite.exec("INSERT INTO categories(id,slug,name,is_active) VALUES(1,'visible','Visible',1),(2,'hidden','Hidden',0)");
  const insert=sqlite.prepare("INSERT INTO products(id,slug,name,description,brand,category_id,is_active,published_at,show_price) VALUES(?,?,?,?,?,?,?,?,?)");
  for(let i=1;i<=44;i++) {
   insert.run(i,"item-"+i,"Cable "+String(i).padStart(2,"0"),"USB cable","Marca",i===44?2:1,i!==43?1:0,i===42?null:"2026-01-01",i===1?0:1);
   sqlite.prepare("INSERT INTO variants(product_id,sku,label,price_pyg,on_hand,is_active) VALUES(?,?,?,?,?,1)").run(i,"SKU-"+i,"One",70000,1);
  }
  const db=drizzle(async(sql,args,method)=>{const statement=sqlite.prepare(sql);return {rows:method==="get"?statement.get(...args):statement.all(...args).map(row=>Object.values(row))};});
  const first=await searchProductsPage("cable",{},db), second=await searchProductsPage("cable",{page:2},db);
  assert.equal(first.total,41);assert.equal(first.totalPages,2);assert.equal(first.products.length,40);assert.equal(second.products.length,1);
  assert.deepEqual([...first.products,...second.products].map(p=>p.id),Array.from({length:41},(_,i)=>i+1));
  assert.equal(first.products[0].variants[0].pricePyg,0);
  assert.equal((await searchProducts("cable",{limit:6},db)).length,6);
  assert.equal((await searchProductsPage("Marca",{page:2},db)).products[0].id,41,"brand fallback count and paging agree");
  assert.equal((await searchProductsPage("cable",{page:999},db)).products.length,0);
 } finally {sqlite.close();}
});
