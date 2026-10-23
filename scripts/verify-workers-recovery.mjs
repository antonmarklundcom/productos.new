import { rehearsePrivateRecovery } from './workers-recovery-private.mjs';
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Local synthetic recovery only: no credentials, existing config or remote flags.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = path.resolve(os.tmpdir());
const work = await mkdtemp(path.join(temporaryRoot, "productos-recovery-"));
const database = "productos-recovery-fixture";
const wrangler = path.join(root, "node_modules/wrangler/wrangler-dist/cli.js");

const source = path.join(work, "source");
const target = path.join(work, "target");
const exported = path.join(work, "synthetic-export.sql");
const childEnv = { ...process.env, WRANGLER_SEND_METRICS: "false" };
for (const key of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CF_API_TOKEN", "CF_API_KEY"]) delete childEnv[key];
function local(args, persist) {
  assert.ok(args.includes("--local") && !args.includes("--remote"));
  const result = spawnSync(process.execPath, [wrangler, ...args, "--config", path.join(persist, "wrangler.json")], {
    cwd: persist, env: childEnv, encoding: "utf8", timeout: 90_000, windowsHide: true,
  });
  if (result.status !== 0) throw new Error("Synthetic local D1 command failed: " + (result.stderr || result.stdout));
  return result.stdout;
}
try {
  for (const folder of [source, target]) {
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'wrangler.json'), JSON.stringify({ name: database, compatibility_date: '2026-10-09', d1_databases: [{ binding: 'DB', database_name: database, database_id: '00000000-0000-4000-8000-000000000099' }] }));
  }
  const migrationNames = (await readdir(path.join(root,"workers/d1/migrations"))).filter(n=>n.endsWith(".sql")).sort().map(n=>n.slice(0,-4));
  const migrations = await Promise.all(migrationNames.map(name => readFile(path.join(root, "workers/d1/migrations", name + ".sql"), "utf8")));
  const seed = path.join(work, "synthetic-seed.sql");
  await writeFile(seed, migrations.join("\n") + "\nINSERT INTO categories(id,slug,name,is_active) VALUES(1,'synthetic','Synthetic',1);\nINSERT INTO products(id,slug,name,category_id,is_active,published_at,sale_mode) VALUES(1,'synthetic','Synthetic',1,1,CURRENT_TIMESTAMP,'enquiry');\nINSERT INTO variants(id,product_id,sku,label,price_pyg,on_hand,is_active) VALUES(1,1,'SYNTH-1','Synthetic',50000,2,1);\nINSERT INTO product_images(product_id,cloudinary_id,position) VALUES(1,'synthetic-image-reference',0);\n");
  local(["d1", "execute", database, "--local", "--file", seed], source);
  local(["d1", "export", database, "--local", "--output", exported], source);
  const bytes = await readFile(exported);
  assert.ok(bytes.length > 1000 && bytes.includes(Buffer.from("SYNTH-1")));
  const schemaExport = path.join(work, 'synthetic-schema.sql');
  const dataExport = path.join(work, 'synthetic-data.sql');
  local(['d1', 'export', database, '--local', '--no-data', '--output', schemaExport], source);
  local(['d1', 'export', database, '--local', '--no-schema', '--output', dataExport], source);
  const restoredData = path.join(work, 'synthetic-restore-data.sql');
  await writeFile(restoredData, 'PRAGMA defer_foreign_keys = true;\n' + await readFile(dataExport, 'utf8'));
  // The fixture source is not modified between these exports. Production needs an accepted consistency procedure.
  // The target has a separate never-used persistence directory.
  local(['d1', 'execute', database, '--local', '--file', schemaExport], target);
  local(['d1', 'execute', database, '--local', '--file', restoredData], target);
  const checks = "SELECT (SELECT COUNT(*) FROM categories) categories,(SELECT COUNT(*) FROM products) products,(SELECT COUNT(*) FROM variants) variants,(SELECT COUNT(*) FROM product_images) images,(SELECT price_pyg FROM variants WHERE sku='SYNTH-1') price,(SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='workers_login_limits_starts_idx') limiter_index; PRAGMA foreign_key_check;";
  const output = local(["d1", "execute", database, "--local", "--command", checks, "--json"], target);
  const parsed = JSON.parse(output);
  assert.deepEqual(parsed[0].results[0], { categories: 1, products: 1, variants: 1, images: 1, price: 50000, limiter_index: 1 });
  assert.deepEqual(parsed[1].results, []);
  const visibility = JSON.parse(local(["d1","execute",database,"--local","--command","SELECT sale_mode,is_active,published_at FROM products WHERE id=1;","--json"],target))[0].results[0];
  assert.equal(visibility.sale_mode,"enquiry"); assert.equal(visibility.is_active,1); assert.ok(visibility.published_at);
  await rehearsePrivateRecovery({root,source,target,local,database,schemaExport,bytes,migrationNames,migrations,counts:parsed[0].results[0]});
  console.log(JSON.stringify({ result: "PASS", scope: "synthetic local D1 Wrangler schema-first export/import", migrations: migrationNames, exportBytes: bytes.length, exportSha256: createHash("sha256").update(bytes).digest("hex"), counts: parsed[0].results[0], foreignKeys: "PASS", productionRecovery: "not exercised" }));
} finally {
  const resolved = path.resolve(work);
  if (!resolved.startsWith(temporaryRoot + path.sep) || !path.basename(resolved).startsWith("productos-recovery-")) throw new Error("Refusing unexpected cleanup target");
  await rm(resolved, { recursive: true, force: true });
}
