import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Run only the published files, outside the checkout. A full node_modules or
// source tree must not hide an incomplete output trace or missing assets.
const staging = await mkdtemp(path.join(tmpdir(), "productos-standalone-"));
let child;
let exited;
try {
  await cp(path.resolve(".next/standalone"), staging, {
    recursive: true,
    // Preserve pnpm's relative links into .pnpm; flattening them breaks Node's
    // dependency resolution inside the generated server package.
    dereference: false,
    verbatimSymlinks: true,
    filter: (source) => !path.basename(source).startsWith(".env"),
  });
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve()))
  );
  const origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: staging,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      DATABASE_URL: "",
      SETUP_SECRET: "",
      CRON_SECRET: "",
      LOCAL_CATALOG_PREVIEW: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  exited = once(child, "exit");
  let output = "";
  child.stdout.on("data", (data) => {
    output = (output + data).slice(-8000);
  });
  child.stderr.on("data", (data) => {
    output = (output + data).slice(-8000);
  });
  let health;
  for (let attempt = 0; attempt < 60; attempt++) {
    assert.equal(
      child.exitCode,
      null,
      `Standalone server exited during startup:\n${output}`
    );
    try {
      health = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      break;
    } catch {
      await delay(250);
    }
  }
  assert.ok(health, `Standalone server did not start:\n${output}`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, db: false, cron: false });
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.ok(html.length > 5000, "Homepage HTML is empty");
  const assets = [
    ...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+\.(?:css|js))/g),
  ].map((match) => match[1]);
  assert.ok(
    assets.some((asset) => asset.endsWith(".css")),
    "No CSS referenced"
  );
  assert.ok(
    assets.some((asset) => asset.endsWith(".js")),
    "No JavaScript referenced"
  );
  for (const asset of new Set(assets)) {
    const response = await fetch(`${origin}${asset}`);
    assert.equal(response.status, 200, `Missing standalone asset: ${asset}`);
    assert.ok(
      (await response.arrayBuffer()).byteLength > 0,
      `Empty asset: ${asset}`
    );
  }
  assert.equal(
    (await fetch(`${origin}/brand/mark.svg`)).status,
    200,
    "Public brand asset missing"
  );
  assert.equal((await fetch(`${origin}/api/version`)).status, 503);
  assert.equal((await fetch(`${origin}/setup`)).status, 404);
  console.log(
    "PASS isolated standalone startup, HTML, CSS, JS, public asset and health without a database."
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await exited;
  }
  await rm(staging, { recursive: true, force: true });
}
