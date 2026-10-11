import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import {queueReset,consumeReset,handleAdminRecovery,recoveryEnabled} from '../../workers/d1/admin-recovery.mjs';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,session_version INTEGER DEFAULT 1,is_active INTEGER DEFAULT 1,password_hash TEXT); CREATE TABLE workers_login_limits(key TEXT PRIMARY KEY,starts INTEGER,hits INTEGER);");
 sqlite.exec(readFileSync(new URL('../../workers/d1/migrations/0002_boring_roulette.sql',import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
 sqlite.exec("INSERT INTO users(id,email,password_hash) VALUES(1,'qa@example.invalid','initial');");
 const db={prepare(sql){return{bind(...values){return{first:async()=>sqlite.prepare(sql).get(...values),run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}),sql,values};}};},async batch(statements){sqlite.exec('BEGIN');try{const r=statements.map(s=>({meta:{changes:Number(sqlite.prepare(s.sql).run(...s.values).changes)}}));sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const emails=[];const pending=[];
 const env={DB:db,EMAIL:{send:async message=>{emails.push(message);return{messageId:'qa'};}},ADMIN_PASSWORD_RESET_ENABLED:'true',ADMIN_PASSWORD_RESET_FROM:'no-reply@example.invalid',NEXT_PUBLIC_SITE_URL:'https://stage.invalid'};
 const ctx={waitUntil(p){pending.push(p);}};
 const token=()=>new URL(emails.at(-1).text.match(/https:\/\/\S+/)[0]).hash.slice('#token='.length);
 const user=()=>sqlite.prepare('SELECT session_version,password_hash FROM users').get();
 const rows=()=>sqlite.prepare('SELECT * FROM workers_admin_password_resets').all();
 return{sqlite,db,env,ctx,emails,pending,token,user,rows};
}
const post=(path,data,headers={})=>new Request('https://stage.invalid'+path,{method:'POST',headers:{origin:'https://stage.invalid','content-type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(data)});

test('email contains fragment link; D1 persists digest only; unknown/inactive accounts cannot reset',async()=>{
 const f=fixture();await queueReset(f.db,'qa@example.invalid',f.env,1000);
 assert.equal(f.emails.length,1);assert.match(f.emails[0].text,/restablecer#token=/);assert.notEqual(f.rows()[0].digest,f.token());assert.equal(f.rows()[0].expires_at,901000);
 await queueReset(f.db,'missing@example.invalid',f.env,1000);assert.equal(f.emails.length,1);
 f.sqlite.exec('UPDATE users SET is_active=0');await queueReset(f.db,'qa@example.invalid',f.env,1000);assert.equal(f.emails.length,1);assert.equal(await consumeReset(f.db,f.token(),'LongPassword123',1001),false);f.sqlite.close();
});
test('single-use concurrent reset changes password and revokes sessions atomically',async()=>{
 const f=fixture();await queueReset(f.db,'qa@example.invalid',f.env,1000);const token=f.token();
 const results=await Promise.all([consumeReset(f.db,token,'NewPassword123',1001),consumeReset(f.db,token,'NewPassword123',1001)]);
 assert.equal(results.filter(Boolean).length,1);assert.equal(f.user().session_version,2);assert.equal(f.rows().length,0);assert.equal(await bcrypt.compare('NewPassword123',f.user().password_hash),true);assert.equal(await consumeReset(f.db,token,'OtherPassword123',1002),false);f.sqlite.close();
});
test('new links replace old ones; expired links and stale session versions fail',async()=>{
 const f=fixture();await queueReset(f.db,'qa@example.invalid',f.env,1000);const first=f.token();await queueReset(f.db,'qa@example.invalid',f.env,1001);
 assert.equal(await consumeReset(f.db,first,'LongPassword123',1002),false);assert.equal(await consumeReset(f.db,f.token(),'LongPassword123',901001),false);
 f.sqlite.exec('UPDATE users SET session_version=2');assert.equal(await consumeReset(f.db,f.token(),'LongPassword123',1002),false);assert.equal(f.user().password_hash,'initial');f.sqlite.close();
});
test('recovery page fails closed when unavailable and rejects cross-origin, format and oversized posts',async()=>{
 const f=fixture();assert.equal(recoveryEnabled({...f.env,EMAIL:undefined}),false);
 let r=await handleAdminRecovery(post('/admin/recuperar',{email:'qa@example.invalid'}),{...f.env,EMAIL:undefined},f.ctx);assert.equal(r.status,503);assert.equal(f.rows().length,0);
 r=await handleAdminRecovery(post('/admin/recuperar',{email:'qa@example.invalid'},{origin:'https://evil.invalid'}),f.env,f.ctx);assert.equal(r.status,403);
 r=await handleAdminRecovery(post('/admin/recuperar',{email:'a'.repeat(5000)}),f.env,f.ctx);assert.equal(r.status,400);
 r=await handleAdminRecovery(post('/admin/recuperar',{email:'qa@example.invalid'},{'content-type':'text/plain'}),f.env,f.ctx);assert.equal(r.status,400);assert.equal(f.rows().length,0);f.sqlite.close();
});
test('GET never consumes a token; fragment is cleared client-side; no referrer or cache',async()=>{
 const f=fixture();await queueReset(f.db,'qa@example.invalid',f.env,1000);
 const r=await handleAdminRecovery(new Request('https://stage.invalid/admin/restablecer'),f.env,f.ctx);const html=await r.text();
 assert.equal(r.status,200);assert.equal(f.rows().length,1);assert.match(html,/history.replaceState/);assert.match(html,/location.hash/);assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.match(r.headers.get('content-security-policy'),/form-action 'self'/);f.sqlite.close();
});
test('known and unknown request responses match; shared request limits suppress repeated emails',async()=>{
 const f=fixture();let a=await handleAdminRecovery(post('/admin/recuperar',{email:'qa@example.invalid'}),f.env,f.ctx,1000);let b=await handleAdminRecovery(post('/admin/recuperar',{email:'missing@example.invalid'}),f.env,f.ctx,1000);
 const message=async r=>(await r.text()).match(/<p id="message" role="status">([^<]*)</)[1];assert.equal(await message(a),await message(b));
 for(let i=0;i<8;i++)await handleAdminRecovery(post('/admin/recuperar',{email:'qa@example.invalid'}),f.env,f.ctx,1000);
 await Promise.all(f.pending);assert.equal(f.emails.length,3);assert.equal(f.rows().length,1);f.sqlite.close();
});
test('invalid/mismatched/oversized passwords preserve account and link; valid form succeeds',async()=>{
 const f=fixture();await queueReset(f.db,'qa@example.invalid',f.env,1000);const token=f.token();
 for(const [password,confirm] of [['short1','short1'],['LongPassword123','wrong'],['NoDigitsHere','NoDigitsHere'],['ü'.repeat(40)+'1a','ü'.repeat(40)+'1a']]){
 const r=await handleAdminRecovery(post('/admin/restablecer',{token,password,confirm}),f.env,f.ctx,1001);assert.equal(r.status,400);assert.equal(f.user().password_hash,'initial');}
 const r=await handleAdminRecovery(post('/admin/restablecer',{token,password:'LongPassword123',confirm:'LongPassword123'}),f.env,f.ctx,1001);assert.equal(r.status,200);assert.match(await r.text(),/Contraseña actualizada/);assert.equal(f.user().session_version,2);f.sqlite.close();
});
test('send failure revokes undelivered link and logs only fixed safe code',async()=>{
 const f=fixture();f.env.EMAIL.send=async()=>{throw new Error('sensitive-provider-message');};const log=console.error;const messages=[];console.error=v=>messages.push(v);
 try{await queueReset(f.db,'qa@example.invalid',f.env,1000);assert.equal(f.rows().length,0);assert.deepEqual(messages,['ADMIN_PASSWORD_RESET_EMAIL_FAILED']);}finally{console.error=log;f.sqlite.close();}
});
test('shared consume limit returns 429 and recovers after its window',async()=>{
 const f=fixture();for(let i=0;i<10;i++){
 const r=await handleAdminRecovery(post('/admin/restablecer',{token:'invalid',password:'LongPassword123',confirm:'LongPassword123'}),f.env,f.ctx,1000);assert.equal(r.status,400);
 }
 let r=await handleAdminRecovery(post('/admin/restablecer',{token:'invalid',password:'LongPassword123',confirm:'LongPassword123'}),f.env,f.ctx,1000);assert.equal(r.status,429);
 r=await handleAdminRecovery(post('/admin/restablecer',{token:'invalid',password:'LongPassword123',confirm:'LongPassword123'}),f.env,f.ctx,3601000);assert.equal(r.status,400);assert.equal(f.user().session_version,1);f.sqlite.close();
});
test('issuing a new link during a consume cannot have that new link deleted by the failed consume',async()=>{
 const f=fixture();await queueReset(f.db,'qa@example.invalid',f.env,1000);const first=f.token();const batch=f.db.batch.bind(f.db);let replaced=false;
 f.db.batch=async statements=>{if(!replaced&&statements[0].sql.startsWith('UPDATE users')){replaced=true;await queueReset(f.db,'qa@example.invalid',f.env,1002);}return batch(statements);};
 assert.equal(await consumeReset(f.db,first,'LongPassword123',1001),false);assert.equal(f.rows().length,1);assert.equal(f.user().session_version,1);assert.equal(await consumeReset(f.db,f.token(),'LongPassword123',1003),true);f.sqlite.close();
});