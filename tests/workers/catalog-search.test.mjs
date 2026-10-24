import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {normalizedSearchBackfill, normalizedSearchTriggers} from "../../workers/d1/search-normalization.mjs";
import {searchPlan} from "../../workers/d1/catalog-search-sql.mjs";
export function searchFixture(size=70) {
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE categories(id INTEGER PRIMARY KEY,is_active INTEGER); CREATE TABLE products(id INTEGER PRIMARY KEY,slug TEXT,name TEXT,brand TEXT,description TEXT,category_id INTEGER,is_active INTEGER,published_at TEXT); INSERT INTO categories VALUES(1,1),(2,0)");
 const insert=db.prepare("INSERT INTO products VALUES(?,?,?,?,?,?,?,?)");
 const put=(id,name,brand="",description="",category=1,active=1,published="2026-10-23")=>insert.run(id,"fixture-"+id,name,brand,description,category,active,published);
 put(1,"Café eléctrico","Ñandutí","Taza térmica");
 put(2,"Kit de café eléctrico");
 put(3,"Accesorio","Marca","Café eléctrico");
 put(4,"Café eléctrico oculto","", "",1,0);
 put(5,"Café eléctrico borrador","","",1,1,null);
 put(6,"Café eléctrico categoría oculta","","",2);
 put(7,"100% algodón_A!","Marca");
 put(8,"100X algodónZA!");
 put(9,"Niño","");put(10,"Nino","");
 for(let id=20;id<size+20;id++)put(id,"Termo de acero "+String(id).padStart(4,"0"),"Térmica");
 db.exec("ALTER TABLE products ADD COLUMN search_name TEXT; ALTER TABLE products ADD COLUMN search_brand TEXT; ALTER TABLE products ADD COLUMN search_description TEXT;");
 db.exec(normalizedSearchBackfill); for (const trigger of normalizedSearchTriggers) db.exec(trigger);
 return db;
}
const run=(db,term,options)=>{const plan=searchPlan(term,options);return plan.statements?plan.statements.map(({sql,args})=>db.prepare(sql).all(...args)):[[],[{total:0}]];};
test("Spanish search folds accents, ranks exact name and matches reordered words",()=>{
 const db=searchFixture();
 try {
  assert.deepEqual(run(db,"CAFE ELECTRICO")[0].map(x=>x.id),[1,2,3]);
  assert.deepEqual(run(db,"eléctrico café")[0].map(x=>x.id),[1,2,3]);
  assert.deepEqual(run(db,"nanduti")[0],[]);
  assert.deepEqual(run(db,"ñanduti")[0].map(x=>x.id),[1]);
  assert.deepEqual(run(db,"nino")[0].map(x=>x.id),[10]);
 }finally{db.close();}
});
test("wildcards and punctuation are literal and page/count share visibility rules",()=>{
 const db=searchFixture();
 try{
  assert.deepEqual(run(db,"100% algodón_A!")[0].map(x=>x.id),[7]);
  const [first,count]=run(db,"acero termo",{page:1,perPage:40});
  const [second,count2]=run(db,"acero termo",{page:2,perPage:40});
  assert.equal(first.length,40);assert.equal(second.length,30);
  assert.equal(count[0].total,70);assert.equal(count2[0].total,70);
  assert.equal(new Set([...first,...second].map(x=>x.id)).size,70);
  assert.deepEqual(run(db,"cafe electrico")[1].map(x=>x.total),[3]);
  assert.equal(searchPlan("a").statements,undefined);
  assert.equal(searchPlan("word ".repeat(100)).statements,undefined);
 }finally{db.close();}
});

test('precomputed fields retain exact predicate/ranking/count parity with repeated expressions',()=>{
 const db=searchFixture();
 try {for(const term of ['CAFE ELECTRICO','eléctrico café','ÑANDUTÍ','100% algodón_A!','Niño','acero termo','uno dos tres cuatro cinco seis siete ocho nueve diez once doce']){
  for(const page of [1,2]){
   const materialized=searchPlan(term,{page}),repeated=searchPlan(term,{page},false);
   assert.deepEqual(materialized.statements.map(s=>db.prepare(s.sql).all(...s.args)),repeated.statements.map(s=>db.prepare(s.sql).all(...s.args)));
  }
 }}finally{db.close();}
});

test("normalization triggers update search projections on insert and edit",()=>{
 const db=searchFixture(0);
 try {
  db.exec("UPDATE products SET name='Cámara nueva',brand='ÑANDÚ',description='TÉRMICA' WHERE id=1");
  assert.deepEqual(run(db,"camara ñandu termica")[0].map(r=>r.id),[1]);
  assert.equal(run(db,"cafe electrico")[1][0].total,2);
  db.exec("INSERT INTO products(id,slug,name,brand,description,category_id,is_active,published_at) VALUES(99,'insert','CÁMARA','ÑANDÚ','TÉRMICA',1,1,'2026-10-24')");
  assert.deepEqual(run(db,"camara ñandu termica")[0].map(r=>r.id),[99,1]);
 } finally {db.close();}
});
