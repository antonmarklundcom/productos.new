import { defineConfig } from "vite";
import vinext, { type NextConfig as VinextNextConfig } from "vinext";
import type { NextConfig } from "next";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";
import { readFileSync } from "node:fs";
import { publicBuildDefines } from "./workers/public-build-env.mjs";
import { d1StagingPlugin } from "./workers/d1/build-plugin.mjs";
import { PUBLIC_PREFETCH_CACHE_SECONDS } from "./workers/d1/public-cache-budget.mjs";
import nextConfig from "./next.config";

// Hostinger's builder re-types next.config.ts as a plain Next `NextConfig`
// (env values may be `undefined`, `typescript` has no index signature, ...),
// which vinext's own `NextConfig` rejects. Keep only string env values and
// hand vinext its config type at this one boundary, so the type check passes
// both there and locally.
const sharedNextConfig: NextConfig = nextConfig;
const workersNextConfig = {
  ...sharedNextConfig,
  env: Object.fromEntries(
    Object.entries(sharedNextConfig.env ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ),
  experimental: {
    ...sharedNextConfig.experimental,
    staleTimes: { static: PUBLIC_PREFETCH_CACHE_SECONDS, dynamic: 0 },
  },
  // Keep shared headers/env, but Workers emits its own bundle. Node standalone
  // packaging tries to resolve Cloudflare virtual Wasm modules as npm packages.
  output: undefined,
} as VinextNextConfig;

export default defineConfig({
  define: publicBuildDefines(readFileSync(path.resolve(import.meta.dirname, "wrangler.jsonc"), "utf8"), process.env),
  plugins: [
    d1StagingPlugin(import.meta.dirname),
    {
      name: "workers-preview-disable-background-isr",
      enforce: "pre",
      transform(code, id) {
        // Request-scoped preview clients cannot outlive their response. Disable
        // background ISR only in this isolated Vite build; Next/Hostinger stays unchanged.
        if (/[/\\]src[/\\]app[/\\].*page\.tsx(?:\?|$)/.test(id))
          return code.replace(/export const revalidate = \d+;/g, "export const revalidate = 0;");
      },
    },
    vinext({ nextConfig: workersNextConfig }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  resolve: {
    alias: [
      {find: /^@\/config\/catalog-capabilities$/, replacement: path.resolve(import.meta.dirname,"workers/d1/catalog-capabilities.ts")},
      {find: /^@\/db\/schema$/, replacement: path.resolve(import.meta.dirname,"workers/d1/schema.ts")},
      {find: /^@\/db$/, replacement: path.resolve(import.meta.dirname,"workers/d1/database.ts")},
      {find: /^@\/domain\/supplier-costs$/, replacement: path.resolve(import.meta.dirname,"workers/d1/supplier-costs.ts")},
      {find: /^@\/domain\/store-settings$/, replacement: path.resolve(import.meta.dirname,"workers/d1/store-settings.ts")},
      {find: /^@\/domain\/catalog-import-plan$/, replacement: path.resolve(import.meta.dirname,"workers/d1/catalog-import-plan.ts")},
      {find: /^@\/domain\/admin-categories$/, replacement: path.resolve(import.meta.dirname,"workers/d1/admin-categories.ts")},
      {find: "sharp", replacement: path.resolve(import.meta.dirname,"empty-stub.js")},
    ],
  },
});
