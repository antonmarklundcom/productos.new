import { JSDOM } from "jsdom";
import { resolveStreamedHtml } from "./workers-demo-html.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const source = args[args.indexOf("--source") + 1];
const catalogPath = args[args.indexOf("--catalog") + 1];
if (source !== "http://127.0.0.1:8790" || !args.includes("--catalog"))
  throw new Error("Use --source http://127.0.0.1:8790 --catalog <public-only catalog JSON>");
const rows = JSON.parse(await readFile(catalogPath, "utf8"));
if (rows.length !== 262 || new Set(rows.map((row) => row.Slug)).size !== 262)
  throw new Error("Expected the final 262 unique public catalog rows");
const slug = (name) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const categories = [...new Set(rows.map((row) => row["Categoría"]))];
const routes = ["/", "/contacto", "/envios", "/preguntas-frecuentes", "/devoluciones", "/privacidad", "/terminos", "/buscar"];
for (const category of categories) {
  const count = rows.filter((row) => row["Categoría"] === category).length;
  for (let page = 1; page <= Math.ceil(count / 12); page++)
    routes.push(`/categoria/${slug(category)}${page > 1 ? `?page=${page}` : ""}`);
}
routes.push(...rows.map((row) => `/producto/${row.Slug}`));
const target = path.join(process.cwd(), "workers/catalog-demo");
await mkdir(target, { recursive: true });
const manifest = { capturedAt: new Date().toISOString(), products: 262, images: rows.reduce((count, row) => count + row.Fotos.split("|").filter(Boolean).length, 0), categories: 9, routes: {} };
const snapshot = { ...manifest, pages: {}, css: "" };
const cards = new Map();
const documents = new Map();
let cssUrl;
for (const route of routes) {
  const response = await fetch(source + route, { signal: AbortSignal.timeout(30000) });
  if (response.status !== 200) throw new Error(`Capture stopped: ${route} HTTP ${response.status}`);
  const html = await response.text();
  if (/app\.dropi\.com\.py|supplier_cost_pyg|Nuestro catálogo todavía no está disponible/.test(html))
    throw new Error(`Capture stopped: ${route} contains private fields or unavailable catalog`);
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  resolveStreamedHtml(doc);
  if (route.startsWith("/producto/") && !doc.querySelector(".gallery-main img")) throw new Error(`Missing gallery: ${route}`);
  if (route.startsWith("/categoria/") && doc.querySelectorAll('[data-testid="product-card"]').length === 0) throw new Error(`Empty category: ${route}`);
  for (const card of doc.querySelectorAll('[data-testid="product-card"]')) cards.set(card.getAttribute("data-slug"), card.outerHTML);
  cssUrl ??= doc.querySelector('link[rel="stylesheet"]')?.getAttribute("href");
  doc.querySelectorAll('script:not([type="application/ld+json"]), link[rel="modulepreload"], link[as="script"], link[rel="preload"]').forEach((item) => item.remove());
  doc.querySelectorAll('link[rel="stylesheet"]').forEach((item) => item.setAttribute("href", "/catalog-demo-style.css"));
  doc.querySelectorAll('[nonce]').forEach((item) => item.removeAttribute("nonce"));
  doc.querySelectorAll('[href^="/pedido"], [href^="/cuenta"], [href^="/carrito"], [href^="/favoritos"], [href^="https://wa.me"]').forEach((item) => item.remove());
  doc.querySelectorAll('[data-testid="header-cart-link"]').forEach((item) => item.remove());
  doc.querySelectorAll('button').forEach((button) => {
    if (!button.closest(".product-gallery") && button.getAttribute("data-testid") !== "header-menu-trigger" && button.getAttribute("type") !== "submit") button.remove();
  });
  doc.querySelectorAll('link[rel="canonical"], meta[property="og:url"]').forEach((item) => item.remove());
  const notice = doc.createElement("div"); notice.className = "demo-notice";
  notice.textContent = "Vista de prueba · Copia del catálogo del 9/10/2026 · Sin pedidos ni administración";
  doc.body.prepend(notice);
  const script = doc.createElement("script"); script.src = "/catalog-demo.js"; script.defer = true; doc.body.append(script);
  const icon = doc.createElement("link"); icon.rel = "icon"; icon.type = "image/svg+xml"; icon.href = "/catalog-demo-icon.svg"; doc.head.append(icon);
  documents.set(route, dom);
  if (documents.size % 25 === 0) console.log(`Captured ${documents.size}/${routes.length} public pages`);
}
if (cards.size !== 262 || manifest.images !== 821) throw new Error("Incomplete product cards/image reference parity");
const search = documents.get("/buscar").window.document;
const main = search.querySelector("main");
main.replaceChildren();
const heading = search.createElement("h1"); heading.textContent = "Buscar productos"; heading.className = "text-3xl font-semibold";
const status = search.createElement("p"); status.className = "demo-search-status";
const grid = search.createElement("div"); grid.className = "demo-search-results mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4";
grid.innerHTML = [...cards.values()].join("");
main.append(heading, status, grid);
// Remove nonfunctional wishlist controls from the copied cards too.
grid.querySelectorAll("button").forEach((item) => item.remove());
for (const [route, dom] of documents) {
  const id = createHash("sha256").update(route).digest("hex").slice(0, 16);
  manifest.routes[route] = id;
  snapshot.pages[id] = dom.serialize();
  dom.window.close();
}
const cssResponse = await fetch(source + cssUrl);
if (!cssResponse.ok) throw new Error("CSS capture failed");
snapshot.css = await cssResponse.text();
snapshot.css += `\n.demo-notice{padding:8px 16px;background:#fff4cc;color:#443700;font:12px/1.4 system-ui;text-align:center}.demo-menu-dialog{position:fixed;inset:0 0 0 auto;margin:0;height:100dvh;width:min(100%,24rem);max-height:100dvh;border:0;padding:24px;overflow-y:auto}.demo-menu-dialog a{display:flex;padding:12px 0}.demo-menu-dialog h2{font-size:22px;margin:20px 0}.demo-menu-dialog button,.demo-image-dialog button{padding:12px;border:1px solid #ccc;border-radius:8px}.demo-image-dialog{width:min(90vw,900px);padding:20px;border:0}.demo-image-dialog img{position:static;width:100%;height:auto;max-height:80vh;object-fit:contain}.demo-menu-dialog::backdrop,.demo-image-dialog::backdrop{background:#0008}.demo-search-results [hidden]{display:none}\n`;
const archive = gzipSync(JSON.stringify(snapshot));
await writeFile(path.join(target, "pages.json.gz"), archive);
await writeFile(path.join(target, "manifest.mjs"), `const manifest = ${JSON.stringify(manifest, null, 2)};\nexport default manifest;\n`);
console.log(JSON.stringify({ pages: documents.size, products: cards.size, images: manifest.images, compressedBytes: archive.length }));
