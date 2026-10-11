import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicBuildDefines} from '../../workers/public-build-env.mjs';
const config=JSON.stringify({vars:{NEXT_PUBLIC_SITE_URL:'https://stage.invalid',NEXT_PUBLIC_IMAGENES_URL:'https://images.invalid',SESSION_SECRET:'not-for-client'}});
test('Workers builds inline only whitelisted public URLs consistently',()=>{
 const result=publicBuildDefines('// JSONC comments are supported\n'+config,{SESSION_SECRET:'not-for-client'});
 assert.deepEqual(result,{'process.env.NEXT_PUBLIC_SITE_URL':'"https://stage.invalid"','process.env.NEXT_PUBLIC_IMAGENES_URL':'"https://images.invalid"'});
 assert.equal(JSON.stringify(result).includes('SESSION_SECRET'),false);
});
test('explicit build overrides win; absent/unsafe values fail before deployment',()=>{
 assert.equal(publicBuildDefines(config,{NEXT_PUBLIC_IMAGENES_URL:'https://other-images.invalid/'} )['process.env.NEXT_PUBLIC_IMAGENES_URL'],'"https://other-images.invalid"');
 for(const value of ['', 'http://images.invalid','https://user:pass@images.invalid','https://images.invalid?token=value','https://images.invalid#x',undefined]){
 assert.throws(()=>publicBuildDefines(config,{NEXT_PUBLIC_IMAGENES_URL:value}),/NEXT_PUBLIC_IMAGENES_URL requires a public HTTPS URL/);
 }
 assert.throws(()=>publicBuildDefines('{ invalid JSONC'),/not valid JSONC/);
});