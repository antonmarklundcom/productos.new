import { test, expect } from "@playwright/test";
import { JSDOM } from "jsdom";
import {
  createHarness,
  origin,
} from "../../scripts/workers-browser-harness.mjs";
let h;
test.beforeAll(async () => {
  h = await createHarness();
});
test.afterAll(async () => {
  await h?.close();
});
async function html(route, headers = {}) {
  const response = await fetch(h.baseURL + route, {
    headers: { accept: "text/html", ...headers },
    redirect: "manual",
  });
  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
  };
}
function doc(text) {
  return new JSDOM(text).window.document;
}
function robot(document) {
  return [...document.querySelectorAll("meta[name=robots]")]
    .map((e) => e.content)
    .join(",");
}
test("fixture sitemap canonical 200s, hidden exclusion, noindex, JSON-LD and real HTTP error status", async () => {
  const sitemap = await html("/sitemap.xml");
  expect(sitemap.status).toBe(200);
  const urls = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    m[1].replaceAll("&amp;", "&")
  );
  expect(urls.length).toBeGreaterThan(3);
  expect(urls).toContain(origin + "/producto/synthetic-visible");
  expect(sitemap.text).not.toContain("synthetic-hidden");
  for (const url of urls) {
    expect(new URL(url).origin).toBe(origin);
    const result = await html(new URL(url).pathname + new URL(url).search);
    expect(result.status, "sitemap route " + new URL(url).pathname).toBe(200);
    const d = doc(result.text);
    expect(
      new URL(d.querySelector("link[rel=canonical]")?.getAttribute("href")).href
    ).toBe(new URL(url).href);
    expect(robot(d)).not.toMatch(/noindex/);
    expect(result.headers.get("x-robots-tag") || "").not.toMatch(/noindex/);
    expect(result.text).not.toContain("Synthetic hidden private marker");
  }
  for (const route of [
    "/producto/synthetic-hidden",
    "/categoria/missing-fixture",
    "/categoria/synthetic?page=999",
    "/buscar?q=synthetic&page=999",
  ]) {
    const result = await html(route);
    expect(result.status, route + " must return HTTP 404").toBe(404);
    expect(result.text).not.toContain("Synthetic hidden private marker");
  }
  for (const route of [
    "/buscar?q=synthetic",
    "/categoria/synthetic?orden=precio-asc",
  ]) {
    const result = await html(route);
    expect(result.status).toBe(200);
    expect(result.text).not.toContain("Synthetic hidden private marker");
    expect(
      robot(doc(result.text)) + "," + (result.headers.get("x-robots-tag") || "")
    ).toMatch(/noindex/);
  }
  for (const slug of ["synthetic-visible", "synthetic-no-price"]) {
    const result = await html("/producto/" + slug);
    expect(result.status).toBe(200);
    expect(result.text).not.toContain("Synthetic hidden private marker");
    const data = [
      ...doc(result.text).querySelectorAll(
        'script[type="application/ld+json"]'
      ),
    ].map((e) => JSON.parse(e.textContent));
    const serialized = JSON.stringify(data);
    expect(serialized).toContain("Product");
    expect(serialized).not.toContain('"offers"');
    if (slug === "synthetic-no-price")
      expect(serialized).not.toContain("98765");
  }
  const outage = await html("/sitemap.xml", { "x-fixture-outage": "true" });
  expect(outage.status).toBe(503);
  expect(outage.headers.get("cache-control")).toContain("no-store");
  expect(outage.text).not.toContain("synthetic-visible");
  // Existing sitemap policy for query failure is static fallback without products.
  // Use a new runtime so no successful query cache can conceal the outage.
  const failing = await createHarness();
  try {
    const response = await fetch(failing.baseURL + "/sitemap.xml", {
      headers: { "x-fixture-query-outage": "true" },
    });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain("<urlset");
    expect(text).not.toContain("/producto/");
    expect(text).not.toContain("synthetic-hidden");
    expect(response.headers.get("cache-control")).toContain("no-store");
  } finally {
    await failing.close();
  }
});
