import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import bcrypt from 'bcryptjs';
import {sha256} from './workers-media-integrity.mjs';
import {validateRecoveryManifest,verifyRecoveryObjects} from './workers-recovery-manifest.mjs';
const require=createRequire(import.meta.url);
export async function rehearsePrivateRecovery({root,source,target,schemaExport,bytes,migrationNames,migrations,counts}) {
 const ts=require('typescript'),mod={exports:{}};
 const code=ts.transpileModule(await readFile(path.join(root,'src/lib/secret-box.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','module','exports',code)(id=>id==='./session-secret'?{validSessionSecret:s=>typeof s==='string'&&s.length>=32}:require(id),mod,mod.exports);
 const env={SESSION_SECRET:randomBytes(48).toString('hex')},password=randomBytes(24).toString('hex'),value=randomBytes(24).toString('hex'),context='integraciones/whatsapp/token';
 const hash=await bcrypt.hash(password,10),encrypted=mod.exports.cifrarSecreto(value,context,env);
 // Private synthetic values stay in memory, never command arguments/files/logs.
 // D1 fixture holds only hashes/encrypted ciphertext; bound parameters avoid CLI output.
 const instances=[];
 try {
 for(const dir of [source,target])instances.push(new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("isolated")}}',compatibilityDate:'2026-10-09',r2Buckets:['IMAGES'],d1Databases:['PRIVATE'],resourcePersistencePath:path.join(dir,'private-resources')})));
 const databases=await Promise.all(instances.map(m=>m.getD1Database('PRIVATE')));
 await databases[0].exec('CREATE TABLE recovery_private(password_hash TEXT,encrypted TEXT,role TEXT,session_version INTEGER);');
 await databases[0].prepare('INSERT INTO recovery_private VALUES(?,?,?,?)').bind(hash,encrypted,'owner',3).run();
 const row=await databases[0].prepare('SELECT * FROM recovery_private').first();
 await databases[1].exec('CREATE TABLE recovery_private(password_hash TEXT,encrypted TEXT,role TEXT,session_version INTEGER);');
 await databases[1].prepare('INSERT INTO recovery_private VALUES(?,?,?,?)').bind(row.password_hash,row.encrypted,row.role,row.session_version).run();
 const restored=await databases[1].prepare('SELECT * FROM recovery_private').first();
 assert.equal(restored.role,'owner');assert.equal(restored.session_version,3);assert.ok(await bcrypt.compare(password,restored.password_hash));
 assert.equal(mod.exports.descifrarSecreto(restored.encrypted,context,env),value);
 assert.throws(()=>mod.exports.descifrarSecreto(restored.encrypted,context,{SESSION_SECRET:randomBytes(48).toString('hex')}),/descifrar/);
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 const media=['original','card','thumb'].map(v=>({key:`synthetic-image-reference/${v}.png`,size:image.length,sha256:sha256(image),width:1,height:1,contentType:'image/png'}));
 const [from,to]=await Promise.all(instances.map(m=>m.getR2Bucket('IMAGES')));
 for(const e of media){await from.put(e.key,image,{httpMetadata:{contentType:e.contentType}});const o=await from.get(e.key);await to.put(e.key,await o.arrayBuffer(),{httpMetadata:o.httpMetadata});}
 await verifyRecoveryObjects(to,media);await assert.rejects(()=>verifyRecoveryObjects(to,[{...media[0],key:'missing'}]),/RECOVERY_IMAGE_MISSING/);
 const revision=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim();assert.match(revision,/^[a-f0-9]{40}$/);
 const manifest={format:1,revision,capturedAt:new Date().toISOString(),migrations:migrationNames.map((name,i)=>({name,sha256:sha256(migrations[i])})),schemaSha256:sha256(await readFile(schemaExport)),sqlSha256:sha256(bytes),counts,media};
 validateRecoveryManifest(manifest,structuredClone(manifest));assert.throws(()=>validateRecoveryManifest(manifest,{...manifest,migrations:[]}),/migrations/);
 console.log(JSON.stringify({recoveryManifest:manifest,settings:'PASS actual secret-box code',owner:'PASS hash/role/session-version; isolated private fixture, not HTTP login',r2:'PASS local byte copy',negativeChecks:'wrong key/missing object/migration mismatch PASS'}));
 }finally{await Promise.all(instances.map(m=>m.dispose()));}
}


