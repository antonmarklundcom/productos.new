import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {d1StagingPlugin} from '../../workers/d1/build-plugin.mjs';
import {verifyNativeCatalogBundle} from '../../workers/d1/build-verification.mjs';
test('Workers catalog adapters preserve directives, guards, batching and the existing request ceiling',()=>{
 const root=path.resolve(import.meta.dirname,'../..'),plugin=d1StagingPlugin(root);
 for(const name of ['product-images','catalog-import']){
   const f=path.join(root,'src/components/admin',name+'.tsx');
   const transformed=plugin.transform(readFileSync(f,'utf8'),f).code;
   assert.match(transformed,/^"use client";/);
   if(name==='product-images')assert.match(transformed,/await prepareR2ImageForm\(data\)/);
   else{assert.match(transformed,/batchOffset/);assert.match(transformed,/800\*1024/);assert.match(transformed,/El último lote puede haberse guardado/);}
 }
 assert.match(readFileSync(path.join(root,'workers/d1/policy.mjs'),'utf8'),/size > 1048576/);
 const code=readFileSync(path.join(root,'workers/d1/catalog-actions.ts'),'utf8');
 assert.equal((code.match(/await requireStaffSession\(\)/g)||[]).length,3);
 assert.match(code,/eq\(productImages.productId,value.productId!/);
 assert.throws(()=>verifyNativeCatalogBundle('legacy Cloudinary upload'),/omitted native catalog/);
 assert.doesNotThrow(()=>verifyNativeCatalogBundle('D1_CATALOG_BATCH_FAILED Falta una foto en R2 La foto preparada tiene un formato o tamaño inválido'));
});
test('native catalog writes preserve stock, suppliers and images and roll back conflicts',{timeout:120000},()=>{
 const root=path.resolve(import.meta.dirname,'../..');
 const result=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/verify-workers-catalog.mts'],{cwd:root,encoding:'utf8',timeout:110000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/PASS: local D1 catalog/);
});
