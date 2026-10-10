import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";

import { verifyNativeSettingsBundle } from "../workers/d1/build-verification.mjs";
const root = process.cwd();
async function serverJavaScript(directory) {
  const files = await readdir(directory, {withFileTypes:true});
  return (await Promise.all(files.map(file => file.isDirectory() ? serverJavaScript(path.join(directory,file.name)) : file.name.endsWith(".js") ? readFile(path.join(directory,file.name),"utf8") : ""))).join("\n");
}
verifyNativeSettingsBundle(await serverJavaScript(path.join(root,"dist/server")));
const snapshot = JSON.parse(gunzipSync(await readFile(path.join(root, "workers/catalog-demo/pages.json.gz"))));
if (snapshot.products !== 262 || snapshot.images !== 821 || Object.keys(snapshot.pages).length < 280)
  throw new Error("Catalog demo completeness check failed");
const target = path.join(root, "dist/client/__catalog-demo");
await mkdir(target, { recursive: true });
for (const [id, html] of Object.entries(snapshot.pages)) {
  if (!/^[a-f0-9]{16}$/.test(id) || /app\.dropi\.com\.py|supplier_cost_pyg|DATABASE_URL|R2_SECRET_ACCESS_KEY/.test(html))
    throw new Error("Unsafe catalog demo artifact");
  await writeFile(path.join(target, `${id}.html`), html);
}
await writeFile(path.join(root, "dist/client/catalog-demo-style.css"), snapshot.css);
await writeFile(path.join(root, "dist/client/catalog-demo.js"), await readFile(path.join(root, "workers/catalog-demo/browser.mjs")));
console.log(`Prepared ${Object.keys(snapshot.pages).length} public snapshot pages; ${snapshot.products} products, ${snapshot.images} R2 references. No database/images uploaded.`);

await writeFile(path.join(root, "dist/client/catalog-demo-icon.svg"), await readFile(path.join(root, "src/app/icon.svg")));
