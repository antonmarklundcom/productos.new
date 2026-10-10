import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";
import { readFileSync } from "node:fs";
import { publicBuildDefines } from "./workers/public-build-env.mjs";
import { d1StagingPlugin } from "./workers/d1/build-plugin.mjs";
import nextConfig from "./next.config";

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
    // Keep shared headers/env, but Workers emits its own bundle. Node standalone
    // packaging tries to resolve Cloudflare virtual Wasm modules as npm packages.
    vinext({ nextConfig: { ...nextConfig, output: undefined } }),
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
      {find: /^@\/domain\/admin-categories$/, replacement: path.resolve(import.meta.dirname,"workers/d1/admin-categories.ts")},
      {find: "sharp", replacement: path.resolve(import.meta.dirname,"empty-stub.js")},
    ],
  },
});
