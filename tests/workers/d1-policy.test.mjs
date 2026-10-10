import assert from 'node:assert/strict';
import {test} from 'node:test';
import {d1StagingRoute,protectStagingResponse} from '../../workers/d1/policy.mjs';
import {d1StagingPlugin} from '../../workers/d1/build-plugin.mjs';
import {readFileSync} from 'node:fs';
import path from 'node:path';
test('D1 exposes only catalog, login and supported admin routes',()=>{
 for(const route of ['/','/contacto','/categoria/autos-y-motos','/producto/cepillo','/admin','/admin/login','/admin/productos','/admin/productos/1','/admin/categorias','/admin/estado?seccion=ajustes'])assert.equal(d1StagingRoute(new Request('https://stage.invalid'+route)),null);
 for(const route of ['/checkout','/api/setup/init','/admin/usuarios','/admin/integraciones','/api/cron/vencer-pedidos','/__catalog-demo/private.html'])assert.equal(d1StagingRoute(new Request('https://stage.invalid'+route)).status,404);
});
test('D1 mutations require a same-origin POST to an admin route',()=>{
 assert.equal(d1StagingRoute(new Request('https://stage.invalid/admin/productos',{method:'POST',headers:{origin:'https://stage.invalid'}})),null);
 for(const origin of ['https://attacker.invalid','null',''])assert.equal(d1StagingRoute(new Request('https://stage.invalid/admin/productos',{method:'POST',headers:{origin}})).status,403);
 for(const method of ['PUT','PATCH','DELETE'])assert.equal(d1StagingRoute(new Request('https://stage.invalid/admin/productos',{method})).status,405);
 assert.equal(d1StagingRoute(new Request('https://stage.invalid/',{method:'POST',headers:{origin:'https://stage.invalid'}})).status,405);
 assert.equal(d1StagingRoute(new Request('https://stage.invalid/admin/productos',{method:'POST',headers:{origin:'https://stage.invalid','content-length':'1048577'}})).status,413);
});
test('D1 responses retain auth cookie/CSP and prohibit shared caching/indexing',()=>{
 const result=protectStagingResponse(new Response('ok',{headers:{'set-cookie':'ecom_admin=opaque; HttpOnly; Secure; SameSite=Lax','content-security-policy':"default-src 'self'"}}));
 assert.match(result.headers.get('set-cookie'),/HttpOnly/);
 assert.equal(result.headers.get('content-security-policy'),"default-src 'self'");
 assert.equal(result.headers.get('cache-control'),'private, no-store');
 assert.match(result.headers.get('x-robots-tag'),/noindex/);
});
test('D1 action guard blocks IDs even when posted to another allowed page',()=>{
 const root=path.resolve(import.meta.dirname,'../..');
 const plugin=d1StagingPlugin(root);
 const source=readFileSync(path.join(root,'src/app/actions/admin-products.ts'),'utf8');
 const transformed=plugin.transform(source,path.join(root,'src/app/actions/admin-products.ts')).code;
 assert.match(transformed,/saveD1SupplierOffer\(productId, variantId/);
 assert.doesNotMatch(transformed,/await db\.transaction\(async \(tx\) =>/);
 for(const name of ['adjustVariantStock','applyCatalogImport','bulkAdjustProductPrices','duplicateProductAction']){
  const body=transformed.slice(transformed.indexOf('export async function '+name));
  assert.match(body.slice(body.indexOf('{'),body.indexOf('{')+160),/throw new Error\("Esta función/);
 }
 const auth=plugin.transform(readFileSync(path.join(root,'src/app/actions/admin-auth.ts'),'utf8'),path.join(root,'src/app/actions/admin-auth.ts')).code;
 assert.match(auth,/await rateLimit\(/);assert.match(auth,/await resetRateLimitKey\(/);
});

test('D1 session facade defers read-only cookie writes and uses request-scoped secret',()=>{
 const root=path.resolve(import.meta.dirname,'../..');const plugin=d1StagingPlugin(root);
 const source=readFileSync(path.join(root,'src/lib/session.ts'),'utf8');
 const result=plugin.transform(source,path.join(root,'src/lib/session.ts')).code;
 assert.doesNotMatch(result,/process.env.SESSION_SECRET/);
 assert.match(result,/getD1SessionSecret\(\)/);
 assert.match(result,/set: \(\.\.\.args: Parameters<typeof cookieStore.set>\) => cookieStore.set\(\.\.\.args\)/);
});

test('D1 dashboard raw day boundaries use the UTC column encoder',()=>{
 const root=path.resolve(import.meta.dirname,'../..');const plugin=d1StagingPlugin(root);
 const file=path.join(root,'src/domain/admin-dashboard.ts');
 const result=plugin.transform(readFileSync(file,'utf8'),file).code;
 assert.match(result,/sql\.param\(start, orders\.createdAt\)/);
 assert.match(result,/sql\.param\(end, orders\.createdAt\)/);
 assert.throws(()=>plugin.transform('export const changed = true;',file),/source drift/);
});
test('D1 full navigation keeps unported destinations on an authenticated status page',()=>{
 const root=path.resolve(import.meta.dirname,'../..');const plugin=d1StagingPlugin(root);
 const file=path.join(root,'src/app/admin/(panel)/layout.tsx');
 const result=plugin.transform(readFileSync(file,'utf8'),file).code;
 assert.match(result,/filter\(\(item\) => can\(actor.role, item.capability\)\)/);
 assert.match(result,/admin\/estado\?seccion=/);
 assert.match(result,/availabilityLabel: "Pendiente"/);
 assert.equal(d1StagingRoute(new Request('https://stage.invalid/admin/ajustes')).status,404);
});
