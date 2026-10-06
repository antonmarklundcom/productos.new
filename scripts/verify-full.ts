import "../src/lib/load-env";
import { runPnpm } from "./package-runner";
import { CAMPOS } from "@/lib/integraciones";
import { randomBytes } from "node:crypto";

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    'Full validation requires a disposable TEST_DATABASE_URL containing "test".'
  );
const database = new URL(process.env.TEST_DATABASE_URL).pathname;
if (!/test/i.test(database))
  throw new Error(
    'Refusing to validate against a database without "test" in its name.'
  );
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  REQUIRE_DATABASE_TESTS: "1",
};
for (const key of Object.keys(env)) {
  if (
    /^(CLOUDINARY_|WHATSAPP_|PAGOPAR_|BANCO_|NEXT_PUBLIC_GA4_|NEXT_PUBLIC_META_)/.test(
      key
    ) ||
    key === "ERROR_REPORT_URL"
  )
    env[key] = "";
}
Object.assign(env, {
  OWNER_EMAIL: "owner@browser.example.test",
  OWNER_PASSWORD: "Disposable-browser-owner-2026",
  WHATSAPP_NUMBER: "+595981123456",
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
});
env.SESSION_SECRET = randomBytes(32).toString("base64url");
env.CUSTOMER_SESSION_SECRET = "";
env.NEXT_PUBLIC_SITE_URL = `http://127.0.0.1:${env.E2E_PORT?.trim() || 3000}`;
for (const fields of Object.values(CAMPOS))
  for (const field of fields)
    if (!(field.env === "WHATSAPP_NUMBER")) env[field.env] = "";
for (const args of [
  ["typecheck"],
  ["lint"],
  ["test", "--maxWorkers=2"],
  ["exec", "tsx", "scripts/prepare-browser-tests.ts"],
  ["build"],
  ["exec", "playwright", "test"],
]) {
  runPnpm(args, { stdio: "inherit", env });
}
