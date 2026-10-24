import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sanitizedBrowserMessage} from '../../scripts/fixtures/browser-diagnostics.mjs';
test('only explicitly requested owner browser fixture enables HTTPS and local certificate trust',()=>{
 const harness=readFileSync('scripts/workers-browser-harness.mjs','utf8'),spec=readFileSync('tests/workers-e2e/audit47.spec.mjs','utf8');
 assert.match(harness,/secureTransport = false/);assert.match(harness,/https: secureTransport/);assert.match(harness,/route\.abort\("blockedbyclient"\)/);
 assert.match(spec,/secureFixture:\[false,\{option:true\}\]/);assert.match(spec,/test\.use\(\{secureFixture:true,ignoreHTTPSErrors:true\}\)/);
 assert.match(spec,/cookie\?\.secure\)\.toBe\(true\)/);assert.match(spec,/cookie\?\.httpOnly\)\.toBe\(true\)/);
 const production=readFileSync('src/lib/session.ts','utf8');assert.match(production,/secure: process\.env\.NODE_ENV === "production"/);assert.doesNotMatch(production,/secureTransport|ignoreHTTPSErrors/);
});
test('fixture diagnostics redact full and WebKit-split URL state and private values',()=>{
 for(const value of ['Fetch API cannot load http://127.0.0.1:1234/admin?token=synthetic#fragment','/127.0.0.1:1234/admin?_rsc=synthetic due to access control checks.','Error owner@fixture.invalid password=synthetic token=private','A'.repeat(1000)]){
  const safe=sanitizedBrowserMessage(value);assert.ok(safe.length<=240);assert.doesNotMatch(safe,/127\.0\.0\.1|_rsc|synthetic|fragment|owner@|token=private/);
 }
});
