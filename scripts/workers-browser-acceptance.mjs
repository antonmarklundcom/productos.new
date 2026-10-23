import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
for (const key of Object.keys(env))
  if (/^(?:CLOUDFLARE_|CF_API_|OWNER_|DATABASE_URL$|SESSION_SECRET$)/.test(key))
    delete env[key];
const result = spawnSync(
  process.execPath,
  [
    require.resolve("@playwright/test/cli"),
    "test",
    "--config",
    "playwright.workers.config.ts",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env, windowsHide: true }
);
process.exitCode = result.status ?? 1;
