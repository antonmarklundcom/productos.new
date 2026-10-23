import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {boundedAdminRequest,d1StagingRoute} from '../../workers/d1/policy.mjs';
const request=(body,headers={})=>new Request('https://stage.invalid/admin/productos',{method:'POST',headers:{origin:'https://stage.invalid',...headers},body,duplex:'half'});
test('actual bytes enforce one MiB for absent and fake lengths before form parsing',async()=>{
 for(const headers of [{},{'content-length':'0'},{'content-length':'12'}]){
  let cancelled=false;
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(1048576));c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
  const input=request(stream,headers);assert.equal(d1StagingRoute(input),null);
  const result=await boundedAdminRequest(input);assert.equal(result.status,413);assert.equal(cancelled,true);assert.equal(await result.text(),'Request too large.');
 }
 const exact=await boundedAdminRequest(request(new Uint8Array(1048576)));assert.ok(exact instanceof Request);assert.equal((await exact.arrayBuffer()).byteLength,1048576);
});
test('valid URL-encoded and multipart uploads retain fields/files and action headers through the real Request parser',async()=>{
 const url=request('name=hello&sku=USB_C_100%25',{'content-type':'application/x-www-form-urlencoded','next-action':'opaque','cookie':'ecom_admin=opaque'});
 const bounded=await boundedAdminRequest(url);const parsed=await bounded.formData();assert.equal(parsed.get('sku'),'USB_C_100%');assert.equal(bounded.headers.get('next-action'),'opaque');assert.equal(bounded.headers.get('cookie'),'ecom_admin=opaque');
 const data=new FormData();data.set('name','Prueba');data.set('file',new Blob([new Uint8Array(800*1024)],{type:'image/webp'}),'photo.webp');
 const multipart=await boundedAdminRequest(request(data));const form=await multipart.formData();assert.equal(form.get('name'),'Prueba');assert.equal(form.get('file').name,'photo.webp');assert.equal(form.get('file').size,800*1024);
});
test('origin and route gates precede buffering; interrupted reads return a safe failure',async()=>{
 assert.equal(d1StagingRoute(request('x',{origin:'https://other.invalid'})).status,403);
 const broken=new ReadableStream({start(c){c.error(new Error('private transport failure'));}});
 const response=await boundedAdminRequest(request(broken));assert.equal(response.status,400);assert.equal(await response.text(),'Invalid request body.');
 const source=readFileSync(new URL('../../workers/preview-entry.mjs',import.meta.url),'utf8');assert.ok(source.indexOf('const blocked = d1StagingRoute(request)')<source.indexOf('await boundedAdminRequest(request)'));assert.ok(source.indexOf('await boundedAdminRequest(request)')<source.indexOf('await handleAdminRecovery(request'));
});
