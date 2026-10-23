import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecoveryManifest,verifyRecoveryObjects} from '../../scripts/workers-recovery-manifest.mjs';
import {sha256} from '../../scripts/workers-media-integrity.mjs';
test('migration/schema/hash/count drift fails',()=>{const m={format:1,revision:'synthetic',capturedAt:new Date().toISOString(),migrations:['one'],schemaSha256:'x',sqlSha256:'y',counts:{products:1},media:[]};validateRecoveryManifest(m,structuredClone(m));for(const field of ['migrations','schemaSha256','sqlSha256','counts'])assert.throws(()=>validateRecoveryManifest(m,{...m,[field]:null}),/RECOVERY_MANIFEST_MISMATCH/);});
test('missing/corrupt media fails',async()=>{const bytes=Buffer.from('test'),entry={key:'image',size:4,sha256:sha256(bytes),contentType:'image/png'};const bucket={get:async()=>({arrayBuffer:async()=>bytes,httpMetadata:{contentType:'image/png'}})};await verifyRecoveryObjects(bucket,[entry]);await assert.rejects(()=>verifyRecoveryObjects({get:async()=>null},[entry]),/MISSING/);await assert.rejects(()=>verifyRecoveryObjects(bucket,[{...entry,sha256:'bad'}]),/HASH/);});
