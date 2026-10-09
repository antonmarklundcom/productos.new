import assert from "node:assert/strict";
import { test } from "node:test";
import { handlePreviewRequest } from "../../workers/preview-policy.mjs";

test("private routes and mutation attempts never invoke the application", async () => {
  let calls = 0;
  const next = () => { calls++; return new Response("private"); };
  for (const path of ["/admin", "/admin/productos", "/cuenta", "/checkout", "/api/setup/init", "/api/cron/vencer-pedidos", "/pedido/buscar", "/categoria/%2e%2e%2fadmin"])
    assert.equal((await handlePreviewRequest(new Request(`https://preview.invalid${path}`), next)).status, 404);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    assert.equal((await handlePreviewRequest(new Request("https://preview.invalid/producto/test", { method, headers: { "next-action": "example" } }), next)).status, 405);
  assert.equal(calls, 0);
});

test("public requests are anonymous and preserve streaming bodies and CSP", async () => {
  const request = new Request("https://preview.invalid/producto/test", { headers: { cookie: "example=private", authorization: "Bearer example" } });
  const response = await handlePreviewRequest(request, async (anonymous) => {
    assert.equal(anonymous.headers.get("cookie"), null);
    assert.equal(anonymous.headers.get("authorization"), null);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("public")); controller.close(); } }), {
      headers: { "Content-Security-Policy": "default-src 'self'", "Set-Cookie": "example=private", "Cache-Control": "public, max-age=300" },
    });
  });
  assert.equal(await response.text(), "public");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("content-security-policy"), "default-src 'self'");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
});

test("robots blocks indexing without touching the database and HEAD has no body", async () => {
  const robots = await handlePreviewRequest(new Request("https://preview.invalid/robots.txt"), () => { throw new Error("must not run"); });
  assert.match(await robots.text(), /Disallow: \/\n/);
  const headRobots = await handlePreviewRequest(new Request("https://preview.invalid/robots.txt", { method: "HEAD" }), () => { throw new Error("must not run"); });
  assert.equal(await headRobots.text(), "");
  const head = await handlePreviewRequest(new Request("https://preview.invalid/", { method: "HEAD" }), () => new Response("page"));
  assert.equal(await head.text(), "");
});

test("public help and GET search pages remain browsable without allowing actions", async () => {
  for (const path of ["/devoluciones", "/privacidad", "/terminos", "/buscar?q=cepillo", "/health"]) {
    const response = await handlePreviewRequest(new Request(`https://preview.invalid${path}`), () => new Response("public"));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
  }
});
