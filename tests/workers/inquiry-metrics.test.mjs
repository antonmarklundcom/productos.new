import assert from "node:assert/strict";
import test from "node:test";
import { handleInquiryMetrics } from "../../workers/d1/inquiry-metrics.mjs";

const origin = "https://fixture.example";
const endpoint = origin + "/api/catalog/inquiry-metrics";
const enabled = { WORKERS_INQUIRY_METRICS_ENABLED: "true" };
const view = { event: "product_view", productId: 42 };

function post(metric, headers = {}, url = endpoint) {
  return new Request(url, {
    method: "POST",
    headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: JSON.stringify(metric),
  });
}

test("records the allowlisted product view and each click placement separately", async () => {
  const records = [];
  for (const metric of [view, ...["inline", "sticky"].map((placement) =>
    ({ event: "whatsapp_click", productId: 42, placement }))]) {
    const response = await handleInquiryMetrics(post(metric), enabled, (row) => records.push(row));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
    assert.deepEqual(records.at(-1), { metric: "catalog_inquiry", ...metric });
  }
});

test("stays off by default and rejects foreign, overlong and identity-bearing input", async () => {
  const rejectRecord = () => assert.fail("Unexpected metric");
  assert.equal(await handleInquiryMetrics(new Request(origin), enabled, rejectRecord), null);
  assert.equal((await handleInquiryMetrics(post(view), {}, rejectRecord)).status, 404);
  assert.equal((await handleInquiryMetrics(new Request(endpoint), enabled, rejectRecord)).status, 405);
  assert.equal((await handleInquiryMetrics(post(view, {}, endpoint + "?tag=1"), enabled, rejectRecord)).status, 404);
  assert.equal((await handleInquiryMetrics(post(view, { origin: "https://foreign.example" }), enabled, rejectRecord)).status, 403);
  assert.equal((await handleInquiryMetrics(post(view, { "sec-fetch-site": "cross-site" }), enabled, rejectRecord)).status, 403);
  assert.equal((await handleInquiryMetrics(post(view, { "sec-gpc": "1" }), enabled, rejectRecord)).status, 204);
  assert.equal((await handleInquiryMetrics(post(view, { "content-type": "text/plain" }), enabled, rejectRecord)).status, 415);
  assert.equal((await handleInquiryMetrics(post({ ...view, contact: "test@example.invalid" }), enabled, rejectRecord)).status, 400);
  assert.equal((await handleInquiryMetrics(post({ ...view, extra: "x".repeat(130) }), enabled, rejectRecord)).status, 400);
  assert.equal((await handleInquiryMetrics(post({ ...view, productId: 0 }), enabled, rejectRecord)).status, 400);
  assert.equal((await handleInquiryMetrics(post({ ...view, event: "received" }), enabled, rejectRecord)).status, 400);
});
