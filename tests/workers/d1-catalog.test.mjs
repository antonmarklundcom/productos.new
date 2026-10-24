import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {d1StagingPlugin} from '../../workers/d1/build-plugin.mjs';
import {verifyNativeCatalogBundle} from '../../workers/d1/build-verification.mjs';
test('Workers catalog adapters preserve directives, guards, batching and the existing request ceiling',()=>{
 const root=path.resolve(import.meta.dirname,'../..'),plugin=d1StagingPlugin(root);
 for(const name of ['product-images','catalog-import']){
   const f=path.join(root,'src/components/admin',name+'.tsx');
   const transformed=plugin.transform(readFileSync(f,'utf8'),f).code;
   assert.match(transformed,/^"use client";/);
   if(name==='product-images'){assert.match(transformed,/await prepareR2ImageForm\(data, prepareOptions\)/);assert.ok(transformed.indexOf("if (prepareOptions.signal.aborted) return;")<transformed.indexOf("const result = await uploadProductImage(data);"));}
   else{assert.match(transformed,/batchOffset/);assert.match(transformed,/800\*1024/);assert.match(transformed,/recibos guardados evitan repetir/);}
 }
 assert.match(readFileSync(path.join(root,'workers/d1/policy.mjs'),'utf8'),/size > 1048576/);
 const code=readFileSync(path.join(root,'workers/d1/catalog-actions.ts'),'utf8');
 const ast=ts.createSourceFile('catalog-actions.ts',code,ts.ScriptTarget.Latest,true);
 const bodyOf=name=>{const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(fn?.body,`missing native action ${name}`);return fn.body.getText(ast);};
 for(const name of ["applyD1CatalogImport","uploadD1ProductImage","saveD1Product","saveD1ProductVariant"]){assert.match(bodyOf(name),/await requireStaffSession\(\)/);}
 const helper=bodyOf('galleryAction');assert.match(helper,/await requireStaffSession\(\)/);assert.ok(helper.indexOf('await requireStaffSession()')<helper.indexOf('mutateGallery('));
 for(const [name,kind] of [['removeD1ProductImage','remove'],['editD1ProductImage','alt'],['reorderD1ProductImages','reorder'],['restoreD1ProductImage','restore']])assert.match(bodyOf(name),new RegExp('return galleryAction\\(input,"'+kind+'"\\)'));
 const mutations=readFileSync(path.join(root,'workers/d1/gallery-mutations.ts'),'utf8');assert.match(mutations,/DELETE FROM product_images WHERE id=\? AND product_id=\?/);assert.match(mutations,/revisionGuard\(db, input.productId, input.expectedRevision\)/);
 const actionsFile=path.join(root,'src/app/actions/admin-products.ts'),boundActions=plugin.transform(readFileSync(actionsFile,'utf8'),actionsFile).code;
 for(const [source,native] of [['removeProductImage','removeD1ProductImage'],['editProductImage','editD1ProductImage'],['reorderProductImages','reorderD1ProductImages'],['restoreProductImage','restoreD1ProductImage']]){assert.ok(boundActions.includes(source));assert.match(boundActions,new RegExp('return '+native+'\\(_?input\\)')); }
 assert.throws(()=>verifyNativeCatalogBundle('legacy Cloudinary upload'),/omitted native catalog/);
 assert.doesNotThrow(()=>verifyNativeCatalogBundle('D1_CATALOG_BATCH_FAILED Falta una foto en R2 La foto preparada tiene un formato o tamaño inválido'));
});
test('native catalog writes preserve stock, suppliers and images and roll back conflicts',{timeout:120000},()=>{
 const root=path.resolve(import.meta.dirname,'../..');
 const result=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/verify-workers-catalog.mts'],{cwd:root,encoding:'utf8',timeout:110000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/PASS: local D1 catalog/);
});
