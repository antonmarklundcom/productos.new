import {test} from "node:test";
import assert from "node:assert/strict";
import {readOnlyPreviewRoute,makeReadOnlyPreview} from "../../workers/d1/read-only-preview.mjs";
const request=(path,options={})=>new Request("https://preview.invalid"+path,options);
test("preview blocks admin/actions/setup and all mutation methods before application or data access",async()=>{
  let calls=0;
  const preview=makeReadOnlyPreview({fetch:async()=>{calls++;return new Response("public");}});
  for(const path of ["/","/producto/first","/categoria/tools","/admin/productos","/api/setup/init","/api/admin/proxy-diagnostic"])
    for(const method of ["POST","PUT","PATCH","DELETE"]) {
      const response=await preview.fetch(request(path,{method}),{},{});
      assert.equal(response.status,405);assert.equal(response.headers.get("cache-control"),"private, no-store");
    }
  for(const path of ["/admin/login","/admin/recuperar","/admin/restablecer","/admin/productos","/setup","/api/setup/init","/api/cron/backup","/__catalog-demo/data"])
    assert.equal((await preview.fetch(request(path),{},{})).status,404);
  assert.equal((await preview.fetch(request("/producto/first",{headers:{"next-action":"known-action"}}),{},{})).status,405);
  assert.equal(calls,0);
  const admin=readOnlyPreviewRoute(request("/admin"));assert.equal(admin.status,307);assert.equal(admin.headers.get("location"),"/admin/login");
});
test("preview retains cache/stream policy on public reads while enforcing noindex and read-only mode",async()=>{
  let seen;
  const preview=makeReadOnlyPreview({fetch:async(_request,env)=>{seen=env;return new Response("catalogue",{headers:{"cache-control":"public, max-age=0, s-maxage=20"}});}});
  const result=await preview.fetch(request("/producto/first"),{WORKERS_PRODUCTION_READY:"true",DB:"same-binding"},{});
  assert.equal(seen.WORKERS_PRODUCTION_READY,"false");assert.equal(seen.DB,"same-binding");
  assert.equal(result.headers.get("cache-control"),"public, max-age=0, s-maxage=20");assert.match(result.headers.get("x-robots-tag"),/noindex/);
  assert.equal(result.headers.get("x-preview-read-only"),"true");assert.equal(await result.text(),"catalogue");
  assert.match(await readOnlyPreviewRoute(request("/robots.txt")).text(),/Disallow: \//);
});
