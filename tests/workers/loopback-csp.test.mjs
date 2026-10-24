import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {adaptHttpLoopbackCsp} from "../../scripts/fixtures/loopback-csp.mjs";
const policy="default-src 'self'; script-src 'self' 'nonce-synthetic'; connect-src 'self'; upgrade-insecure-requests; form-action 'self'; frame-ancestors 'none'";
test("HTTP loopback fixture removes only the exact upgrade directive",()=>{
 const headers=new Headers({'content-security-policy':policy,'content-security-policy-report-only':policy,'cache-control':'private, no-store','x-robots-tag':'noindex'});
 adaptHttpLoopbackCsp(headers,new URL('http://127.0.0.1:12345/buscar?q=synthetic'));
 const expected=policy.split(';').filter(d=>d.trim()!=='upgrade-insecure-requests').join(';');
 assert.equal(headers.get('content-security-policy'),expected);assert.equal(headers.get('content-security-policy-report-only'),expected);
 assert.equal(headers.get('cache-control'),'private, no-store');assert.equal(headers.get('x-robots-tag'),'noindex');
 assert.match(expected,/nonce-synthetic/);assert.match(expected,/form-action 'self'/);assert.match(expected,/connect-src 'self'/);
});
test("HTTPS, public hosts and nonfixture loopback spellings keep the complete policy",()=>{
 for(const url of ['https://127.0.0.1:12345','https://productos.com.py','http://productos.com.py','http://localhost:12345','http://127.0.0.2:12345']){
  const headers=new Headers({'content-security-policy':policy});adaptHttpLoopbackCsp(headers,url);assert.equal(headers.get('content-security-policy'),policy);
 }
 const headers=new Headers({'content-security-policy':"default-src 'self'; report-uri /upgrade-insecure-requests"});adaptHttpLoopbackCsp(headers,'http://127.0.0.1:12345');assert.equal(headers.get('content-security-policy'),"default-src 'self'; report-uri /upgrade-insecure-requests");
});
test("production retains its upgrade policy and does not import fixture adaptations",()=>{
 assert.match(readFileSync('src/proxy.ts','utf8'),/upgrade-insecure-requests/);
 for(const file of ['workers/preview-entry.mjs','workers/d1/public-response.mjs'])assert.doesNotMatch(readFileSync(file,'utf8'),/loopback-csp|adaptHttpLoopbackCsp/);
 const harness=readFileSync('scripts/workers-browser-harness.mjs','utf8');assert.match(harness,/route\.abort\("blockedbyclient"\)/);assert.match(harness,/Worker outbound access forbidden/);
});
