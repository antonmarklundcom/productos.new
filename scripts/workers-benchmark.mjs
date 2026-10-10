import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import { setTimeout as pause } from "node:timers/promises";
import { writeFile } from "node:fs/promises";

export function workerCost(requests, cpuMs) {
  return 5 + Math.max(0, requests - 10_000_000) / 1_000_000 * 0.30 + Math.max(0, cpuMs - 30_000_000) / 1_000_000 * 0.02;
}
const { values } = parseArgs({ options: { url: { type: "string" }, output: { type: "string" }, requests: { type: "string", default: "12" }, "delay-ms": { type: "string", default: "1500" }, "self-test": { type: "boolean" } } });
if (values["self-test"]) {
  assert.equal(workerCost(300_000, 15_000_000), 5);
  assert.equal(workerCost(900_000, 45_000_000), 5.30);
  assert.equal(workerCost(15_000_000, 105_000_000), 8);
  console.log("Cost-model assertions passed. No requests sent; no CPU benchmark performed.");
} else {
  if (!values.url || !values.output) throw new Error("Required: --url https://<staging>.workers.dev --output <report.json>");
  const base = new URL(values.url);
  if (base.protocol !== "https:" || !base.hostname.startsWith("productos-workers-staging.") || !base.hostname.endsWith(".workers.dev") || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("Only the Productos staging workers.dev origin is allowed; production is excluded.");
  const count = Number(values.requests), delay = Number(values["delay-ms"]);
  if (!Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(delay) || delay < 1000) throw new Error("Use 1–100 sequential requests, with at least 1000 ms between them.");
  const paths = ["/", "/categoria/hogar-y-cocina", "/producto/cepillo-limpiador-con-dispenser-de-jabon", "/contacto"];
  const report = { startedAt: new Date().toISOString(), origin: base.origin, cpuMs: null, cpuSource: "Not measured: use Cloudflare CPU metrics. HTTP duration includes network and database waiting.", samples: [], stopped: null };
  for (let index = 0; index < count; index++) {
    const path = paths[index % paths.length]; const start = performance.now();
    try {
      const response = await fetch(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(30_000) });
      const headersMs = performance.now() - start;
      const body = await response.arrayBuffer();
      report.samples.push({ at: new Date().toISOString(), path, status: response.status, headersMs, totalMs: performance.now() - start, bytes: body.byteLength });
      if (response.status !== 200) { report.stopped = `HTTP ${response.status}: do not continue until understood`; break; }
    } catch (error) { report.stopped = error.name; break; }
    if (index + 1 < count) await pause(delay);
  }
  const timings = report.samples.map(sample => sample.totalMs).sort((a,b) => a-b);
  const quantile = fraction => timings.length ? timings[Math.min(timings.length - 1, Math.ceil(timings.length * fraction) - 1)] : null;
  report.httpTiming = { p50Ms: quantile(0.5), p95Ms: quantile(0.95) };
  report.finishedAt = new Date().toISOString();
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ completedRequests: report.samples.length, stop: report.stopped, output: values.output, cpuMs: null }));
  if (report.stopped) process.exitCode = 1;
}
