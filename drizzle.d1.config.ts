import { defineConfig } from "drizzle-kit";
export default defineConfig({ dialect: "sqlite", schema: "./workers/d1/schema.ts", out: "./workers/d1/migrations" });
