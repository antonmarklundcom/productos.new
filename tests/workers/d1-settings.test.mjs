import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {readFileSync} from 'node:fs';
test('native settings save semantics pass on a disposable local D1', {timeout:120000},()=>{
 const root=path.resolve(import.meta.dirname,'../..');
 const result=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/verify-workers-settings.mts'],{cwd:root,encoding:'utf8',timeout:110000});
 assert.equal(result.status,0, result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/PASS: local D1 settings/);
});

import {verifyNativeSettingsBundle} from '../../workers/d1/build-verification.mjs';
test('build fails if settings still compile only to the legacy MySQL implementation',()=>{
 assert.throws(()=>verifyNativeSettingsBundle('saveStoreSettingsSection db.transaction FOR UPDATE'),/omitted native D1/);
 assert.throws(()=>verifyNativeSettingsBundle('json_set without native action'),/omitted native D1/);
 const source=readFileSync(new URL('../../workers/d1/store-settings-write.ts',import.meta.url),'utf8');
 assert.doesNotThrow(()=>verifyNativeSettingsBundle(source));
 for(const marker of ['json_set','expectedSnapshot','SELECT data FROM store_settings WHERE id=1','store_settings.data=','INSERT INTO store_settings (id, data, updated_at, updated_by_user_id)','ON CONFLICT(id) DO UPDATE SET data','RETURNING data','AdminInputError'])assert.throws(()=>verifyNativeSettingsBundle(source.replaceAll(marker,'REMOVED_NATIVE_CONTRACT')),/omitted native D1/);
 assert.throws(()=>verifyNativeSettingsBundle(source.replace('WHERE ${predicate}','REMOVED_PREDICATE')),/omitted native D1/);
});
