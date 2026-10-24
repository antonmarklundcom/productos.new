import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {catalogRead,categoryRead,featuredRead,relatedRead,latestRead} from '../../workers/d1/public-catalog-sql.mjs';
import {searchRead,searchFacetsRead,suggestionsRead} from '../../workers/d1/catalog-search-sql.mjs';
import {normalizedSearchBackfill,normalizedSearchTriggers} from '../../workers/d1/search-normalization.mjs';
import {displayedPriceSql} from '../../workers/d1/display-price-sql.mjs';

function fixture() {
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0000_useful_mattie_franklin','0001_fancy_warhawk','0002_boring_roulette','0003_oval_masked_marvel'])
  sqlite.exec(readFileSync(`workers/d1/migrations/${name}.sql`,'utf8'));
 sqlite.exec(`ALTER TABLE products ADD COLUMN featured_position INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE products ADD COLUMN search_name TEXT NOT NULL DEFAULT '';
 ALTER TABLE products ADD COLUMN search_brand TEXT NOT NULL DEFAULT '';
 ALTER TABLE products ADD COLUMN search_description TEXT NOT NULL DEFAULT '';
 INSERT INTO categories(id,slug,name,position,is_active) VALUES (1,'hogar','Hogar',1,1),(2,'nueva','Nueva',2,1),(3,'oculta','Oculta',3,0);
 INSERT INTO products(id,slug,name,brand,description,category_id,is_active,published_at,sale_mode,show_price) VALUES
 (1,'cafe-uno','Café uno','Ñandutí','Térmico',1,1,'2026-01-01','enquiry',1),
 (2,'cafe-dos','Café dos','Otra','Térmico',1,1,'2026-02-01','enquiry',1),
 (3,'cafe-tres','Café tres','Ñandutí','Térmico',2,1,'2026-03-01','enquiry',1),
 (4,'privado','Café privado','Secret','Térmico',1,0,'2026-04-01','enquiry',1),
 (5,'oculto','Café oculto','Secret','Térmico',3,1,'2026-05-01','enquiry',1),
 (6,'precio-oculto','Café sin precio','Otra','Térmico',2,1,'2026-06-01','showcase',0);
 INSERT INTO variants(product_id,sku,label,price_pyg,on_hand,position,is_active) VALUES
 (1,'ONE-LOW','Sin stock',100,0,1,1),(1,'ONE-HIGH','Con stock',500,1,2,1),
 (2,'TWO','Sin stock',200,0,1,1),(3,'THREE','Sin stock',300,0,1,1),
 (4,'PRIVATE','Private',1,1,1,1),(5,'HIDDEN','Hidden',1,1,1,1),(6,'MASK','Private',999999,0,1,1);`);
 sqlite.exec(normalizedSearchBackfill); for(const trigger of normalizedSearchTriggers)sqlite.exec(trigger);
 const db={prepare(sql){const statement={sql,args:[],bind(...args){return {...statement,args};}};return statement;},async batch(statements){return statements.map(s=>({success:true,results:sqlite.prepare(s.sql).all(...s.args)}));}};
 return {sqlite,db};
}
test('enquiry displayed-price bounds and monotonic sorting agree with mixed stock and conceal hidden prices',async()=>{
 const {db,sqlite}=fixture();try{
  const result=await categoryRead(db,{categorySlug:'hogar',sort:'precio-asc',maxPricePyg:300});
  assert.deepEqual(result.products.map(p=>Math.min(...p.variants.map(v=>v.pricePyg))),[100,200]);
  assert.deepEqual((await categoryRead(db,{categorySlug:'hogar',minPricePyg:100,maxPricePyg:100})).products.map(p=>p.id),[1]);
  const stock=sqlite.prepare(`SELECT ${displayedPriceSql({stockSales:true})} AS price FROM products p WHERE id=1`);
  assert.equal(stock.get().price,100);sqlite.exec("UPDATE products SET sale_mode='stock' WHERE id=1");assert.equal(stock.get().price,500);
  const masked=(await catalogRead(db,{productIds:[6]}))[0];assert.equal(masked.variants[0].pricePyg,0);
 }finally{sqlite.close();}
});
test('native search combines category/brand/budget, ranks stably and returns public facets and small suggestions',async()=>{
 const {db,sqlite}=fixture();try{
  const result=await searchRead(db,'cafe termico',{categorySlug:'hogar',maxPricePyg:200,brand:'Ñandutí',sort:'precio-asc'});
  assert.equal(result.total,1);assert.deepEqual(result.products.map(p=>p.id),[1]);
  assert.deepEqual((await searchRead(db,'cafe',{sort:'precio-desc'})).products.map(p=>p.id),[3,2,1,6]);
  const facets=await searchFacetsRead(db,'cafe');
  assert.deepEqual(facets.brands.map(row=>({...row})),[{brand:'Otra',total:2},{brand:'Ñandutí',total:2}]);
  assert.deepEqual(facets.categories.map(c=>[c.slug,c.total]),[['hogar',2],['nueva',2]]);
  const suggestions=await suggestionsRead(db,'cafe',99);assert.equal(suggestions.length,4);
  for(const row of suggestions) assert.deepEqual(Object.keys(row),['slug','name','brand']);
  assert.doesNotMatch(JSON.stringify({facets,suggestions}),/Secret|PRIVATE|pricePyg|description/);
 }finally{sqlite.close();}
});
test('featured fallback diversifies categories, curated positions win and newest/related include untracked enquiry items',async()=>{
 const {db,sqlite}=fixture();try{
  const fallback=await featuredRead(db,2);assert.equal(new Set(fallback.map(p=>p.categorySlug)).size,2);
  sqlite.exec('UPDATE products SET is_featured=1,featured_position=8 WHERE id=1; UPDATE products SET is_featured=1,featured_position=2 WHERE id=3');
  assert.deepEqual((await featuredRead(db,4)).map(p=>p.id),[3,1]);
  assert.deepEqual((await latestRead(db,[])).map(r=>r.products[0].id),[6,3,2,1]);
  assert.deepEqual((await relatedRead(db,{productId:1,categorySlug:'hogar',brand:'Ñandutí',pricePyg:100})).map(p=>p.id),[2]);
 }finally{sqlite.close();}
});
