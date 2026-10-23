import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {SQLiteAsyncDialect} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
import {d1StagingPlugin} from '../../workers/d1/build-plugin.mjs';
import {MAX_LOGIN_WINDOW_MS,LOGIN_CLEANUP_BATCH,pruneLoginLimits} from '../../workers/d1/login-limit-policy.mjs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const stripImports=source=>source.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export \{[^}]*\} from [^;]*;\r?\n/gm,'');
function load(source,deps){
 const js=ts.transpileModule(stripImports(source),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={}; new Function('exports','deps','const {'+Object.keys(deps).join(',')+'}=deps;'+js)(exports,deps);return exports;
}
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('CREATE TABLE workers_login_limits(key TEXT PRIMARY KEY,starts INTEGER NOT NULL,hits INTEGER NOT NULL);');
 sqlite.exec(readFileSync(path.join(root,'workers/d1/migrations/0003_oval_masked_marvel.sql'),'utf8'));
 const binding={prepare(query){return {bind(...args){return {run:async()=>sqlite.prepare(query).run(...args)};}};}};
 const dialect=new SQLiteAsyncDialect();
 const native={$client:binding,all:async query=>{const q=dialect.sqlToQuery(query);return sqlite.prepare(q.sql).all(...q.params);},run:async query=>{const q=dialect.sqlToQuery(query);return sqlite.prepare(q.sql).run(...q.params);}};
 const limiter=load(readFileSync(path.join(root,'workers/d1/login-limit.ts'),'utf8'),{sql,getNativeDb:()=>native,MAX_LOGIN_WINDOW_MS,pruneLoginLimits});
 return {sqlite,binding,...limiter};
}
test('exhausted IP does not allocate rotating email counters; successful login resets both keys',async()=>{
 const f=fixture(); let ip='fixed', authenticated=false, session={save:async()=>{}};
 const source=readFileSync(path.join(root,'src/app/actions/admin-auth.ts'),'utf8');
 const transformed=d1StagingPlugin(root).transform(source,path.join(root,'src/app/actions/admin-auth.ts')).code;
 const {loginAdmin}=load(transformed,{z,LOGIN_LIMIT:5,LOGIN_WINDOW_MS:900000,headers:async()=>new Headers(),clientIp:()=>ip,rateLimit:(key,options)=>f.rateLimit(key,options,10000000),resetRateLimitKey:f.resetRateLimitKey,authenticate:async()=>authenticated?{id:1,email:'owner@example.invalid',role:'owner',sessionVersion:1}:null,getSession:async()=>session,safeNextPath:()=>'/admin',redirect:()=>{throw new Error('REDIRECT');},t:()=> 'generic',tPlural:()=> 'limited'});
 for(let i=0;i<100;i++){const data=new FormData();data.set('email','rotating'+i+'@example.invalid');data.set('password','wrong');await loginAdmin(data);}
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workers_login_limits').get().n,6);
 authenticated=true;ip='legitimate';const data=new FormData();data.set('email','owner@example.invalid');data.set('password','correct');await assert.rejects(loginAdmin(data),/REDIRECT/);
 assert.equal(session.userId,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workers_login_limits').get().n,6);f.sqlite.close();
});
test('rotating IPs cannot bypass email limit and retention preserves recovery windows',async()=>{
 const f=fixture(),now=10000000;
 for(let i=0;i<6;i++){assert.equal((await f.rateLimit('login:ip:'+i,{limit:5,windowMs:900000},now)).ok,true);assert.equal((await f.rateLimit('login:email:one',{limit:5,windowMs:900000},now)).ok,i<5);}
 const insert=f.sqlite.prepare('INSERT INTO workers_login_limits VALUES(?,?,1)');
 for(let i=0;i<LOGIN_CLEANUP_BATCH+5;i++)insert.run('expired'+i,now-MAX_LOGIN_WINDOW_MS);
 insert.run('recovery-active',now-MAX_LOGIN_WINDOW_MS+1);insert.run('login-old-but-retained',now-900001);
 await pruneLoginLimits(f.binding,now);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workers_login_limits WHERE key LIKE 'expired%'").get().n,5);
 assert.equal(f.sqlite.prepare("SELECT hits FROM workers_login_limits WHERE key='recovery-active'").get().hits,1);
 assert.equal(f.sqlite.prepare("SELECT hits FROM workers_login_limits WHERE key='login-old-but-retained'").get().hits,1);
 const plan=f.sqlite.prepare('EXPLAIN QUERY PLAN SELECT key FROM workers_login_limits WHERE starts <= ? ORDER BY starts LIMIT ?').all(now-MAX_LOGIN_WINDOW_MS,LOGIN_CLEANUP_BATCH);
 assert.match(JSON.stringify(plan),/USING INDEX workers_login_limits_starts_idx/);
 await assert.rejects(f.rateLimit('future',{limit:1,windowMs:MAX_LOGIN_WINDOW_MS+1},now),/WINDOW_UNSUPPORTED/);f.sqlite.close();
});

test('D1 unauthorized dashboard falls back to authenticated availability without querying counts',async()=>{
 const {can}=load(readFileSync(path.join(root,'src/lib/permissions.ts'),'utf8'),{});
 let role='vendedor',reads=0;
 const guardPath=path.join(root,'src/lib/admin-guard.ts');
 const guardSource=d1StagingPlugin(root).transform(readFileSync(guardPath,'utf8'),guardPath).code;
 const guards=load(guardSource,{validateAdminSession:async()=>({id:1,role}),getSession:async()=>({}),can,redirect:url=>{throw new Error('REDIRECT:'+url);},t:()=>'',safeError:x=>x,UnauthorizedError:class extends Error{},ForbiddenError:class extends Error{},actorLabel:()=>'',assertCanTransitionTo:()=>{},requireOwner:()=>{},requireStaff:()=>{}});
 const jsx=(type,props)=>({type,props});
 const summary=load(readFileSync(path.join(root,'workers/d1/admin-summary.tsx'),'utf8'),{requireCapabilityPage:guards.requireCapabilityPage,can,sql,getNativeDb:()=>({get:async()=>{reads++;return{products:1,published:1,categories:1,images:1};}}),Link:()=>{},require:()=>({jsx,jsxs:jsx})}).default;
 await assert.rejects(summary(),/REDIRECT:\/admin\/estado\?seccion=pedidos/);assert.equal(reads,0);
 for(role of ['owner','staff']){await summary();}assert.equal(reads,2);
 const pageSource=readFileSync(path.join(root,'src/app/admin/(panel)/estado/page.tsx'),'utf8');
 const page=load(pageSource,{catalogOnly:true,requireAdminSession:guards.requireAdminSession,can,Link:()=>{},notFound:()=>{throw new Error('404');},require:()=>({jsx,jsxs:jsx})}).default;
 role='vendedor';const result=JSON.stringify(await page({searchParams:Promise.resolve({seccion:'pedidos'})}));
 assert.match(result,/Pendiente de habilitar/);assert.doesNotMatch(result,/href.*\/admin\/(?:productos|categorias)/);assert.match(result,/href.*\//);
});
