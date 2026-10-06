import { defineConfig, devices } from "@playwright/test";

/** Runs against a production build with no DATABASE_URL or optional integrations. */
export default defineConfig({
  testDir: "./tests/deployment",
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3102", ...devices["Desktop Chrome"] },
  webServer: {
    command: "pnpm start --hostname 127.0.0.1 --port 3102",
    url: "http://127.0.0.1:3102",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
