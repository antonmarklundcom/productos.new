import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {searchPlan} from '../workers/d1/catalog-search-sql.mjs';
const output=process.argv[2];
if(process.argv.length>3||output?.startsWith('--'))throw Error('Usage: node scripts/profile-workers-search.mjs [output.json]');
const visible='p.is_active=1 AND p.published_at IS NOT NULL AND c.is_active=1';
function fixture(size){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE categories(id INTEGER PRIMARY KEY,is_active INTEGER);CREATE TABLE products(id INTEGER PRIMARY KEY,slug TEXT,name TEXT,brand TEXT,description TEXT,category_id INTEGER,is_active INTEGER,published_at TEXT);CREATE INDEX products_category_id_idx ON products(category_id);INSERT INTO categories VALUES(1,1),(2,0);BEGIN');
 const insert=db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)');
 const cases=[['Café eléctrico','Ñandutí','Taza térmica'],['Kit de café eléctrico','Casa','Accesorio'],['Accesorio','Marca','Eléctrico para café'],['Niño','Juguete',''],['Nino','Juguete',''],['100% algodón_A!','Textil',''],['100X algodónZA!','Textil','']];
 for(let id=1;id<=size;id++){const row=cases[(id-1)%cases.length];insert.run(id,'synthetic-'+id,row[0]+' '+id,row[1],row[2],id%19===0?2:1,id%17===0?0:1,id%13===0?null:'2026-10-23');}
 db.exec('COMMIT;ANALYZE');return db;
}
function oldPlan(term){const cleaned=term.trim().replace(/[+\-><()~*"@]/g,' ').replace(/\s+/g,' ').trim(),args=['%'+cleaned+'%','%'+cleaned+'%'];const from=' FROM products p JOIN categories c ON c.id=p.category_id WHERE '+visible+' AND ';
 return ['(p.name LIKE ? OR p.description LIKE ?)','(p.name LIKE ? OR p.brand LIKE ?)'].map(predicate=>({count:{sql:'SELECT COUNT(*) AS total'+from+predicate,args},select:{sql:'SELECT p.id,p.slug,p.name,p.brand'+from+predicate+' ORDER BY p.name,p.id LIMIT 40 OFFSET 0',args}}));}
const execute=(db,s)=>db.prepare(s.sql).all(...s.args);
function oldRead(db,plan){let count;for(const candidate of plan){count=execute(db,candidate.count);if(count[0].total)return {rows:execute(db,candidate.select),total:count[0].total};}return {rows:[],total:0};}
function newRead(db,plan){const [select,count]=plan.statements;return {rows:execute(db,select),total:execute(db,count)[0].total};}
const median=numbers=>[...numbers].sort((a,b)=>a-b)[Math.floor(numbers.length/2)];
const profiles=[];
for(const size of [262,1000,10000]){
 const db=fixture(size);
 try{for(const term of ['cafe electrico','eléctrico café','Niño','100% algodón_A!','accesorio']){
  const old=oldPlan(term),modern=searchPlan(term),repeated=searchPlan(term,{},false),samples={old:[],new:[],repeated:[]};let prior,current,repeatedResult;
  for(let round=0;round<9;round++)for(const variant of (round%2?['new','old','repeated']:['repeated','old','new'])){
   const started=performance.now(),result=variant==='old'?oldRead(db,old):newRead(db,variant==='new'?modern:repeated);const elapsed=performance.now()-started;
   if(round>=2)samples[variant].push(elapsed);if(variant==='old')prior=result;else if(variant==='new')current=result;else repeatedResult=result;
  }
  if(JSON.stringify(repeatedResult)!==JSON.stringify(current))throw Error('CTE parity mismatch: '+term);
  profiles.push({products:size,term,repeatedFolding:{medianSqlWallMs:median(samples.repeated),total:repeatedResult.total,samples:samples.repeated},old:{medianSqlWallMs:median(samples.old),total:prior.total,firstIds:prior.rows.slice(0,5).map(r=>r.id),samples:samples.old,explain:old.map(p=>execute(db,{...p.count,sql:'EXPLAIN QUERY PLAN '+p.count.sql}))},new:{medianSqlWallMs:median(samples.new),total:current.total,firstIds:current.rows.slice(0,5).map(r=>r.id),samples:samples.new,explain:modern.statements.map(p=>execute(db,{...p,sql:'EXPLAIN QUERY PLAN '+p.sql}))}});
 }}finally{db.close();}
}
const report={format:1,capturedAt:new Date().toISOString(),scope:'Synthetic in-memory node:sqlite SQL preparation/execution/materialization wall time only; no D1 network, hydration, app render, browser or live data',runtime:process.version,warmups:2,measuredRounds:7,order:'alternating old/new/repeated-folding',indexes:['products primary key','categories primary key','products_category_id_idx'],baseline:'Previous Workers transformed phrase LIKE name/description with brand fallback only on zero first-pass matches; literal wildcards were not escaped',interpretation:'Semantic changes are intentional; additional token folding/ranking work can cost more SQL time. No speed improvement is claimed.',profiles};
if(output){await mkdir(path.dirname(path.resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({result:'PASS',profiles:profiles.length,output:output??null,summary:profiles.map(p=>({products:p.products,term:p.term,oldMs:p.old.medianSqlWallMs,newMs:p.new.medianSqlWallMs,repeatedMs:p.repeatedFolding.medianSqlWallMs,oldCount:p.old.total,newCount:p.new.total}))}));

