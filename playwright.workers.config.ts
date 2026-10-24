import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (process.platform === "win32" && existsSync(chrome) ? chrome : undefined);
export default defineConfig({
  testDir: "./tests/workers-e2e",
  outputDir:
    process.env.WORKERS_BROWSER_OUTPUT ||
    path.join(os.tmpdir(), "productos-workers-browser-results"),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90000,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          process.env.WORKERS_BROWSER_REPORT ||
          "test-results/workers-browser.json",
      },
    ],
  ],
  use: {
    trace: "off",
    screenshot: "off",
    video: "off",
    serviceWorkers: "block",
  },
  projects: [
    { name: "built-worker-chromium", use: { browserName: "chromium", launchOptions: executablePath ? {executablePath} : {} } },
    { name: "built-worker-webkit", testMatch: /audit47\.spec\.mjs$/, use: { browserName: "webkit" } },
    { name: "built-worker-firefox", testMatch: /audit47\.spec\.mjs$/, use: { browserName: "firefox" } },
  ],
});
