import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// En CI las variables ya vienen del job (mismo criterio que `checks`). En
// local, `.env.local` es la única fuente — sin esto, `OWNER_EMAIL`/
// `OWNER_PASSWORD` que usa `panel.spec.ts` para loguearse no llegarían a este
// proceso (Playwright no carga dotenv solo, a diferencia de la app). Si el
// archivo no existe, `dotenv` no hace nada.
config({ path: ".env.local", quiet: true });
const port = Number(process.env.E2E_PORT?.trim() || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("E2E_PORT must be a valid TCP port");

/**
 * Playwright en CI (fable/plan.md §6.1) — lo que ve la compradora en un
 * navegador de verdad, contra un `next build` ya hecho y MySQL real.
 *
 * Sólo Chromium: es el que más se usa en Paraguay y el que ya viene
 * pre-instalado en el runner. Sumar Firefox/WebKit tripicaría el tiempo del
 * job por una cobertura que estas tres specs no necesitan.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // These flows edit shared shipping methods, products and bank settings.
  // Separate browser contexts do not isolate the database configuration.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // Un reintento en CI absorbe el típico timing flake de una animación o un
  // toast; en local, cero — un fallo tiene que verse a la primera.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Casi nunca hace falta: `PLAYWRIGHT_BROWSERS_PATH` (que Playwright
        // ya respeta solo) alcanza en cualquier entorno con los navegadores
        // pre-instalados. Esto es sólo para el caso raro de un Chromium del
        // sistema en una ruta que Playwright no adivina.
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? {
              launchOptions: {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
              },
            }
          : {}),
      },
    },
  ],
  // `next build` corre aparte (en CI: un paso propio; en local: el
  // `pnpm build` de `pnpm test:e2e`) — acá sólo se levanta el server ya
  // compilado, para no pagar el build cada vez que Playwright reintenta un
  // test.
  webServer: {
    command: `pnpm start --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer:
      !process.env.CI && process.env.REQUIRE_DATABASE_TESTS !== "1",
    timeout: 60_000,
  },
});
