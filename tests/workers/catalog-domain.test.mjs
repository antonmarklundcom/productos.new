import test from "node:test";
import assert from "node:assert/strict";
import {canonicalDomainResponse} from "../../workers/catalog-domain.mjs";
const env = {NEXT_PUBLIC_SITE_URL:"https://productos.com.py"};
test("www redirects to HTTPS apex preserving path and query", () => {
  const response = canonicalDomainResponse(new Request("https://www.productos.com.py/admin/login?next=%2Fadmin"), env);
  assert.equal(response.status,308);
  assert.equal(response.headers.get("location"),"https://productos.com.py/admin/login?next=%2Fadmin");
});
test("HTTP apex upgrades to HTTPS; HEAD uses the same redirect", () => {
  const response = canonicalDomainResponse(new Request("http://productos.com.py/categoria/autos-y-motos",{method:"HEAD"}),env);
  assert.equal(response.status,308);
  assert.equal(response.headers.get("location"),"https://productos.com.py/categoria/autos-y-motos");
});
test("canonical and preview hosts are left unchanged", () => {
  for (const url of ["https://productos.com.py/admin", "https://productos-workers-staging.marklundfaktura.workers.dev/", "https://malicious.example/", "https://www.productos.com.py.evil.example/"])
    assert.equal(canonicalDomainResponse(new Request(url),env),null);
});
test("non-canonical mutations are rejected without forwarding", () => {
  const response = canonicalDomainResponse(new Request("https://www.productos.com.py/admin",{method:"POST"}),env);
  assert.equal(response.status,421);
  assert.equal(response.headers.get("location"),null);
});
test("unsafe configuration cannot create an open redirect", () => {
  for (const value of [undefined,"bad", "http://productos.com.py", "https://user:pass@productos.com.py", "https://productos.com.py:8443", "https://productos.com.py/path", "https://productos.com.py?redirect=evil", "https://example.workers.dev", "https://www.productos.com.py"])
    assert.equal(canonicalDomainResponse(new Request("http://productos.com.py/"),{NEXT_PUBLIC_SITE_URL:value}),null);
});
