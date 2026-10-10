import assert from "node:assert/strict";
import { test } from "node:test";
import { serveCatalogDemo } from "../../workers/catalog-demo.mjs";
import { handlePreviewRequest } from "../../workers/preview-policy.mjs";

test("snapshot health explicitly reports no database and no cron", async () => {
  const response = await serveCatalogDemo(new Request("https://preview.invalid/health"), {});
  const data = await response.json();
  assert.equal(data.db, false);
  assert.equal(data.cron, false);
  assert.equal(data.previewMode, "catalog-snapshot");
  assert.equal(data.products, 262);
});

test("snapshot pages preserve preview isolation and deny direct artifacts", async () => {
  let calls = 0;
  const env = { ASSETS: { fetch: async (request) => {
    calls++;
    assert.match(new URL(request.url).pathname, /^\/__catalog-demo\/[a-f0-9]{16}\.html$/);
    assert.equal(request.headers.get("cookie"), null);
    return new Response("snapshot", { headers: { "content-type": "text/html" } });
  } } };
  const next = (request) => serveCatalogDemo(request, env);
  const response = await handlePreviewRequest(new Request("https://preview.invalid/", { headers: { cookie: "private=test" } }), next);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-preview-mode"), "catalog-snapshot");
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy"), /connect-src 'none'/);
  assert.equal(calls, 1);
  for (const path of ["/admin", "/admin/login", "/checkout", "/__catalog-demo/test.html"])
    assert.equal((await handlePreviewRequest(new Request(`https://preview.invalid${path}`), next)).status, 404);
  assert.equal((await handlePreviewRequest(new Request("https://preview.invalid/", { method: "POST" }), next)).status, 405);
  assert.equal(calls, 1);
});

test("missing snapshot assets fail explicitly and HEAD has no body", async () => {
  const missing = await serveCatalogDemo(new Request("https://preview.invalid/producto/missing"), {});
  assert.equal(missing.status, 404);
  const failed = await serveCatalogDemo(new Request("https://preview.invalid/"), { ASSETS: { fetch: () => new Response("missing", { status: 404 }) } });
  assert.equal(failed.status, 503);
  const head = await handlePreviewRequest(new Request("https://preview.invalid/", { method: "HEAD" }), (request) => serveCatalogDemo(request, { ASSETS: { fetch: () => new Response("page") } }));
  assert.equal(await head.text(), "");
});

test("streamed search segments are restored without executing inline scripts", async () => {
  const { JSDOM } = await import("jsdom");
  const { resolveStreamedHtml } = await import("../../scripts/workers-demo-html.mjs");
  const dom = new JSDOM('<html><head></head><body><header><template id="B:0"></template></header><div hidden id="S:0"><form><input name="q" role="combobox" aria-controls="unused"></form></div><div hidden><title>Catalog demo</title></div></body></html>');
  const document = dom.window.document;
  resolveStreamedHtml(document);
  assert.equal(document.querySelector("header input").closest("[hidden]"), null);
  assert.equal(document.querySelector("header input").getAttribute("role"), "searchbox");
  assert.equal(document.querySelector("header input").getAttribute("aria-controls"), null);
  assert.equal(document.head.querySelector("title").textContent, "Catalog demo");
  assert.equal(document.getElementById("S:0"), null);
  dom.window.close();
});
