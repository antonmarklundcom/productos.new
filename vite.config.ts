import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";

export default defineConfig({
  plugins: [
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
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  resolve: {
    alias: {
      "sharp": path.resolve(import.meta.dirname, "empty-stub.js"),
    },
  },
});
