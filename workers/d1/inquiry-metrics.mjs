import { protectStagingResponse } from "./policy.mjs";

const maxBytes = 128;
const endpoint = "/api/catalog/inquiry-metrics";

function reply(status, headers) {
  return protectStagingResponse(new Response(null, { status, headers }));
}

async function readMetric(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;

  const buffer = new Uint8Array(maxBytes);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > maxBytes) {
        void reader.cancel().catch(() => {});
        return null;
      }
      buffer.set(value, offset);
      offset += value.byteLength;
    }

    const metric = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset)));
    if (!metric || typeof metric !== "object" || Array.isArray(metric)) return null;
    if (!Number.isSafeInteger(metric.productId) || metric.productId < 1) return null;

    const { event, productId, placement } = metric;
    const keys = Object.keys(metric);
    if (event === "product_view" && keys.length === 2) return { event, productId };
    if (event === "whatsapp_click" && keys.length === 3 && (placement === "inline" || placement === "sticky")) {
      return { event, productId, placement };
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  return null;
}

export async function handleInquiryMetrics(request, env, record = (metric) => console.info(metric)) {
  const url = new URL(request.url);
  if (url.pathname !== endpoint) return null;
  if (env.WORKERS_INQUIRY_METRICS_ENABLED !== "true" || url.search) return reply(404);
  if (request.method !== "POST") return reply(405, { allow: "POST" });
  if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin") {
    return reply(403);
  }
  if (request.headers.get("sec-gpc") === "1") return reply(204);
  if (request.headers.get("content-type") !== "application/json") return reply(415);
  if (Number(request.headers.get("content-length")) > maxBytes) return reply(413);

  const metric = await readMetric(request);
  if (!metric) return reply(400);
  record({ metric: "catalog_inquiry", ...metric });
  return reply(204);
}
