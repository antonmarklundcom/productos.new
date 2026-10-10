import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
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
 assert.doesNotThrow(()=>verifyNativeSettingsBundle('json_set D1_SETTINGS_SAVE_MISSING_RESULT'));
});
