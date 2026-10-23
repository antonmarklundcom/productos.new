import { chromium } from "@playwright/test";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHarness } from "./workers-browser-harness.mjs";
const output =
  process.env.WORKERS_BROWSER_PROFILE_REPORT ||
  "C:/Claude 1/reports/productos.new/2026-10-23/completion/workers-browser-profile.json";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (process.platform === "win32" && existsSync(chrome) ? chrome : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const rows = [];
try {
  for (const diagnostics of [false, true])
    for (const device of ["desktop", "mobile"])
      for (const [label, route] of [
        ["home", "/"],
        ["category", "/categoria/synthetic"],
        ["product", "/producto/synthetic-visible"],
        ["search", "/buscar?q=synthetic"],
      ]) {
        const h = await createHarness({ diagnostics });
        let context;
        try {
          const images = new Map();
          const base = "synthetic-visible-0123456789";
          for (const box of [240, 480, 800, 1200]) {
            const data = await sharp({
              create: {
                width: box,
                height: Math.round(box * 0.75),
                channels: 3,
                background: "#237d48",
              },
            })
              .webp()
              .toBuffer();
            const key = `p1/${base}-${box}.webp`;
            images.set("/" + key, data);
            await h.bucket.put(key, data, {
              httpMetadata: { contentType: "image/webp" },
            });
          }
          const jpeg = await sharp({
            create: {
              width: 1200,
              height: 900,
              channels: 3,
              background: "#237d48",
            },
          })
            .jpeg()
            .toBuffer();
          images.set(`/p1/${base}.jpg`, jpeg);
          await h.bucket.put(`p1/${base}.jpg`, jpeg, {
            httpMetadata: { contentType: "image/jpeg" },
          });
          await h.db
            .prepare(
              "INSERT INTO product_images(product_id,cloudinary_id,position) VALUES(1,?,0)"
            )
            .bind(`r2:p1/${base}@1200x900`)
            .run();
          context = await browser.newContext({
            viewport:
              device === "mobile"
                ? { width: 390, height: 844 }
                : { width: 1440, height: 1000 },
            deviceScaleFactor: device === "mobile" ? 2 : 1,
            isMobile: device === "mobile",
            serviceWorkers: "block",
          });
          await context.route("**/*", async (intercepted) => {
            const url = new URL(intercepted.request().url());
            if (url.origin === h.baseURL) return intercepted.continue();
            const body = images.get(url.pathname);
            if (body && intercepted.request().resourceType() === "image")
              return intercepted.fulfill({
                status: 200,
                headers: { "timing-allow-origin": "*" },
                contentType: url.pathname.endsWith(".jpg")
                  ? "image/jpeg"
                  : "image/webp",
                body,
              });
            return intercepted.abort("blockedbyclient");
          });
          await context.addInitScript(() => {
            window.__fixtureVitals = { lcp: 0, cls: 0 };
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries())
                window.__fixtureVitals.lcp = entry.startTime;
            }).observe({ type: "largest-contentful-paint", buffered: true });
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries())
                if (!entry.hadRecentInput)
                  window.__fixtureVitals.cls += entry.value;
            }).observe({ type: "layout-shift", buffered: true });
          });
          const page = await context.newPage();
          const response = await page.goto(h.baseURL + route, {
            waitUntil: "networkidle",
          });
          await page.waitForTimeout(250);
          const values = await page.evaluate(() => {
            const nav = performance.getEntriesByType("navigation")[0];
            const imageSources = new Set(
              [...document.images].flatMap((image) => [
                image.currentSrc,
                image.src,
              ])
            );
            return {
              ttfbMs: nav.responseStart - nav.requestStart,
              responseMs: nav.responseEnd - nav.requestStart,
              domContentLoadedMs: nav.domContentLoadedEventEnd,
              lcpMs: window.__fixtureVitals.lcp,
              cls: window.__fixtureVitals.cls,
              images: performance
                .getEntriesByType("resource")
                .filter(
                  (e) => e.initiatorType === "img" || imageSources.has(e.name)
                )
                .map((e) => ({
                  initiator: e.initiatorType,
                  status: e.responseStatus ?? null,
                  startMs: e.startTime,
                  durationMs: e.duration,
                  encodedBytes: e.encodedBodySize,
                })),
              imageElements: [...document.images].map((image) => ({
                width: image.naturalWidth,
                height: image.naturalHeight,
                complete: image.complete,
                loading: image.loading,
                priority: image.fetchPriority,
                top: image.getBoundingClientRect().top,
              })),
              offscreenEager: [...document.images].filter(
                (i) =>
                  i.loading !== "lazy" &&
                  i.getBoundingClientRect().top >= innerHeight
              ).length,
            };
          });
          const httpPair = [];
          for (const attempt of ["first", "repeat"]) {
            const started = performance.now();
            const result = await fetch(h.baseURL + route, {
              headers: { accept: "text/html", "x-fixture-cache": "true" },
            });
            const headersMs = performance.now() - started;
            const bytes = (await result.arrayBuffer()).byteLength;
            httpPair.push({
              attempt,
              status: result.status,
              headersMs,
              completeMs: performance.now() - started,
              bytes,
              cache: result.headers.get("x-catalog-cache"),
              serverTiming: result.headers.get("server-timing") || "",
            });
          }
          let navigation = null;
          if (label === "home") {
            const target = page
              .locator('a[href="/categoria/synthetic"]:visible')
              .first();
            if (await target.count()) {
              const flights = [];
              const requestStarted = new Map();
              const responseMetadata = new Map();
              page.on("response", (result) => {
                if (requestStarted.has(result.request()))
                  responseMetadata.set(result.request(), {
                    status: result.status(),
                    cache: result.headers()["x-catalog-cache"] || null,
                    serverTiming: result.headers()["server-timing"] || "",
                    rsc: (result.headers()["content-type"] || "").includes(
                      "text/x-component"
                    ),
                  });
              });
              page.on("request", (request) => {
                if (
                  new URL(request.url()).origin === h.baseURL &&
                  request.resourceType() === "fetch"
                )
                  requestStarted.set(request, performance.now());
              });
              page.on("requestfinished", (request) => {
                if (requestStarted.has(request))
                  flights.push({
                    durationMs: performance.now() - requestStarted.get(request),
                    timing: request.timing(),
                    ...responseMetadata.get(request),
                  });
              });
              const start = performance.now();
              await target.click();
              await page.waitForURL(
                (url) => url.pathname === "/categoria/synthetic"
              );
              await page.waitForLoadState("networkidle");
              await page.waitForTimeout(100);
              navigation = {
                destination: "category",
                clickToSettledMs: performance.now() - start,
                flights,
              };
            } else
              navigation = {
                destination: "category",
                unavailable: "No visible fixture category link in home",
              };
          }
          rows.push({
            device,
            route: label,
            diagnostics,
            status: response.status(),
            cache: response.headers()["x-catalog-cache"],
            serverTiming: response.headers()["server-timing"] || "",
            d1Batches: response.headers()["x-catalog-d1-batches"] || null,
            d1RowsRead: response.headers()["x-catalog-d1-rows-read"] || null,
            ...values,
            httpPair,
            navigation,
          });
        } finally {
          await context?.close();
          await h.close();
        }
      }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        scope:
          "Synthetic loopback only; fresh D1/R2 per route/device/mode; local image fulfillment; no throttling; timings are not visitor latency; cold browser landing precedes HTTP first/repeat pair so DTOs may already be warm",
        diagnostics:
          "true buffers the complete response; compare only matched mode/device/route",
        samples: rows,
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify({
      result: rows.every((r) => r.status === 200) ? "PASS" : "FAIL",
      samples: rows.length,
      report: output,
    })
  );
} finally {
  await browser.close();
}
