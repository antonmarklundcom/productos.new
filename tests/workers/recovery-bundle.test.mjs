import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { packBundle, verifyBundle, prepareRestore } from '../../scripts/workers-recovery-bundle.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
async function fixture(fn) {
 const root = await mkdtemp(path.join(os.tmpdir(), 'bundle-synthetic-'));
 try {
  const sourceRoot = path.join(root, 'source'); await mkdir(sourceRoot);
  const entries = [['schema.sql','d1-schema','CREATE TABLE synthetic(id INTEGER);'],['data.sql','d1-data','INSERT INTO synthetic VALUES(1);'],['r2/object.bin','r2-object',randomBytes(1024*1024+17)],['private.json','private-config','{"synthetic":"only"}'],['certificate.json','capture-certificate','{"syntheticImmutableFixture":true}']];
  const artifacts = [];
  for (const [name,kind,data] of entries) { const bytes = Buffer.from(data); await mkdir(path.dirname(path.join(sourceRoot,name)),{recursive:true}); await writeFile(path.join(sourceRoot,name),bytes); artifacts.push({path:name,kind,size:bytes.length,sha256:sha(bytes)}); }
  const config = { sourceRoot,privateRoot:root,bundlePath:path.join(root,'bundle'),restorePath:path.join(root,'restore'),policy:{ownerApproved:true,automaticDeletion:false,independentCopy:true,destinationIdentity:'synthetic-only',independenceEvidence:'synthetic failure-boundary assertion; not independent storage',retentionPolicy:'synthetic preserve until fixture teardown',approvalReference:'synthetic test',rpoSeconds:60,rtoSeconds:120},capture:{immutable:true,consistencyAccepted:true,capturedAt:'2026-10-24T00:00:00Z',procedureReference:'unchanged synthetic files',certificateSha256:artifacts.at(-1).sha256},artifacts,restore:{newPrivateIsolatedTarget:true,outgoingIntegrationsDisabled:true,productionTraffic:false} };
  await fn(config,{WORKERS_RECOVERY_KEY:randomBytes(32).toString('hex')});
 } finally { assert.ok(path.basename(root).startsWith('bundle-synthetic-')); await rm(root,{recursive:true,force:true}); }
}
test('streamed encrypted round trip; no plaintext names or contents in bundle; source preserved',()=>fixture(async(c,e)=>{
 assert.equal((await packBundle(c,e)).status,'PASS'); assert.equal((await verifyBundle(c,e)).artifacts,5);
 const names=await readdir(c.bundlePath); assert.equal(names.length,7); assert.ok(!names.some(n=>/sql|object|private|certificate/.test(n)));
 const sealed=await readFile(path.join(c.bundlePath,'manifest.enc')); assert.ok(!sealed.includes(Buffer.from('schema.sql')));
 await prepareRestore(c,e); for(const a of c.artifacts) assert.deepEqual(await readFile(path.join(c.sourceRoot,a.path)),await readFile(path.join(c.restorePath,a.path)));
 await assert.rejects(()=>packBundle(c,e)); await assert.rejects(()=>prepareRestore(c,e));
}));
test('wrong keys, malformed keys and competing key sources fail closed',()=>fixture(async(c,e)=>{
 await packBundle(c,e); await assert.rejects(()=>verifyBundle(c,{WORKERS_RECOVERY_KEY:randomBytes(32).toString('hex')}));
 for(const value of ['', 'a'.repeat(63),'z'.repeat(64)]) await assert.rejects(()=>verifyBundle(c,{WORKERS_RECOVERY_KEY:value}));
 await assert.rejects(()=>verifyBundle({...c,keyFile:path.join(c.sourceRoot,'private.json')},e));
}));
test('tampering, truncation and missing payloads prevent any plaintext target',()=>fixture(async(c,e)=>{
 await packBundle(c,e); const name=(await readdir(c.bundlePath)).find(n=>/^[a-f0-9]{32}.enc$/.test(n)),p=path.join(c.bundlePath,name),original=await readFile(p);
 for(const data of [Buffer.from(original.map((v,i)=>i===12?v^1:v)),original.subarray(0,10)]) { await writeFile(p,data); await assert.rejects(()=>prepareRestore(c,e)); await assert.rejects(()=>readFile(path.join(c.restorePath,'schema.sql'))); }
 await rm(p); await assert.rejects(()=>verifyBundle(c,e));
}));
test('authenticated header and sealed manifest reject modifications',()=>fixture(async(c,e)=>{
 await packBundle(c,e); const hp=path.join(c.bundlePath,'bundle.json'),h=JSON.parse(await readFile(hp,'utf8')); await writeFile(hp,JSON.stringify({...h,bundleId:'0'.repeat(32)})); await assert.rejects(()=>verifyBundle(c,e)); await writeFile(hp,JSON.stringify(h));
 const mp=path.join(c.bundlePath,'manifest.enc'),b=await readFile(mp); b[15]^=1; await writeFile(mp,b); await assert.rejects(()=>verifyBundle(c,e));
}));
test('policy/certificate/hash requirements have no implicit approved defaults',()=>fixture(async(c,e)=>{
 for(const patch of [{policy:undefined},{policy:{...c.policy,ownerApproved:false}},{policy:{...c.policy,automaticDeletion:true}},{policy:{...c.policy,rpoSeconds:0}},{policy:{...c.policy,retentionPolicy:''}},{capture:{...c.capture,consistencyAccepted:false}},{capture:{...c.capture,certificateSha256:'0'.repeat(64)}},{artifacts:c.artifacts.filter(a=>a.kind!=='capture-certificate')}]) await assert.rejects(()=>packBundle({...c,...patch},e));
 await assert.rejects(()=>packBundle({...c,artifacts:c.artifacts.map((a,i)=>i? a:{...a,sha256:'0'.repeat(64)})},e));
}));
test('traversal, duplicate/case aliases, unsafe roots and existing targets rejected',()=>fixture(async(c,e)=>{
 for(const rel of ['../outside','/outside','a/../../outside','C:/outside','a\\b','a//b','a/./b']) await assert.rejects(()=>packBundle({...c,artifacts:c.artifacts.map((a,i)=>i?a:{...a,path:rel})},e));
 await assert.rejects(()=>packBundle({...c,artifacts:[...c.artifacts,{...c.artifacts[0],path:'SCHEMA.sql'}]},e));
 await assert.rejects(()=>packBundle({...c,bundlePath:path.join(c.privateRoot,'..','escape')},e));
 const od=path.join(c.privateRoot,'OneDrive'); await mkdir(od); await assert.rejects(()=>packBundle({...c,privateRoot:od,bundlePath:path.join(od,'bundle')},e));
 await packBundle(c,e); await assert.rejects(()=>prepareRestore({...c,restore:{...c.restore,productionTraffic:true}},e));
}));
test('symlink escape refused where symlinks available',()=>fixture(async(c,e)=>{
 const link=path.join(c.sourceRoot,'alias');
 try { await symlink(path.dirname(c.sourceRoot),link,'junction'); } catch(error) { if(['EPERM','ENOTSUP'].includes(error.code)) return; throw error; }
 const a=c.artifacts[0]; await assert.rejects(()=>packBundle({...c,artifacts:[...c.artifacts,{...a,path:'alias/source/schema.sql'}]},e));
}));
test('private key file supported without key material in summaries',()=>fixture(async(c,e)=>{
 const keyFile=path.join(c.privateRoot,'key'); await writeFile(keyFile,e.WORKERS_RECOVERY_KEY,{mode:0o600}); const result=await packBundle({...c,keyFile},{}); assert.ok(!JSON.stringify(result).includes(e.WORKERS_RECOVERY_KEY)); await verifyBundle({...c,keyFile},{});
}));
test('empty R2 payload authenticates and restores; Git/report/source destinations rejected',()=>fixture(async(c,e)=>{
 const empty={path:'r2/empty.bin',kind:'r2-object',size:0,sha256:sha(Buffer.alloc(0))}; await writeFile(path.join(c.sourceRoot,empty.path),''); c.artifacts.push(empty);
 for(const name of ['reports','other-repo']) { const dir=path.join(c.privateRoot,name); await mkdir(dir); if(name==='other-repo') await writeFile(path.join(dir,'.git'),'synthetic git marker'); await assert.rejects(()=>packBundle({...c,privateRoot:dir,bundlePath:path.join(dir,'bundle')},e)); }
 await assert.rejects(()=>packBundle({...c,bundlePath:path.join(c.sourceRoot,'bundle')},e));
 await packBundle(c,e); await verifyBundle(c,e); await prepareRestore(c,e); assert.equal((await readFile(path.join(c.restorePath,empty.path))).length,0);
}));
