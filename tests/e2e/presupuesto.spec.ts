import { gzipSync } from "node:zlib";

import type { Page, Response } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { TESTIDS } from "./testids";

/**
 * Presupuesto de JS por página (plan-operacion §6.4, ARCH.md §6). Es el
 * único número de esta fase que **bloquea** el PR — Lighthouse (más abajo,
 * en `ci.yml`) sólo advierte.
 *
 * Los techos de acá salen de medir de verdad contra un `next build` +
 * `next start` (no de una cifra aspiracional) y sumarle 10%: son un piso de
 * alarma para no crecer sin darse cuenta, no un objetivo de optimización. Si
 * algún día el número real crece más allá del techo, **no se achica el
 * código desde este spec** — se sube el techo al valor medido + 10%, se
 * anota el chunk culpable en `KNOWN-ISSUES.md` y en plan-operacion §9, y esa
 * es una fase aparte (regla dura de S12).
 *
 * Valores medidos el 2026-09-11 contra un build local (Next 16.3.4,
 * Turbopack), con el seed de `pnpm db:seed`: home 203.6 KB, producto 207.8 KB,
 * checkout 202.5 KB, + 10%. Son ~17 KB menos por página que la medición del
 * 2026-09-06 porque O14 sacó la fuga de `drizzle-orm` al cliente que estaba
 * documentada en `KNOWN-ISSUES.md`: los valores de enum viven ahora en
 * `src/db/enums.ts`, sin el ORM detrás (`tests/unit/db-enums.test.ts` lo
 * cuida). Los techos bajaron al valor nuevo a propósito — dejarlos en el
 * anterior era regalar 17 KB de margen que nadie midió.
 *
 * 2026-09-23: producto y checkout pasaron el techo por 0,2–0,3 KB con
 * favoritos (el corazón del header y de la ficha) y las reseñas. Medido en
 * CI: producto 229.2 KB, checkout 223.3 KB → +10%, según la regla de arriba.
 * Home no pasó su techo y queda igual. Anotado en `KNOWN-ISSUES.md`.
 *
 * 2026-09-29: home pasó su techo por 0,6 KB (224.6 KB) con la identidad y las
 * cuentas desde el panel. La causa es el catálogo de textos, que viaja entero
 * al cliente (cada clave nueva, aunque sea del panel, suma a todas las
 * páginas) → +10%, según la regla de arriba. Anotado en `KNOWN-ISSUES.md`.
 */
const BUDGET_KB = {
  home: 247,
  producto: 252,
  checkout: 246,
} as const;

type ScriptSample = { url: string; sizeBytes: number };

// Mismo origen que `playwright.config.ts` (`use.baseURL`) — hardcodeado acá
// porque comparar contra `page.url()` en el handler de `response` es
// inestable: durante la navegación, `page.url()` todavía puede apuntar a la
// página anterior cuando llega la primera respuesta de la nueva.
const SAME_ORIGIN = `http://127.0.0.1:${process.env.E2E_PORT?.trim() || 3000}`;

/**
 * Bytes realmente transferidos por cada `<script>` del mismo origen que la
 * página cargó — nunca los del fallback `nomodule` (un Chromium evergreen,
 * el único navegador de este job, jamás lo pide).
 *
 * `request.sizes()` lee lo que el protocolo de red reportó como
 * `responseBodySize` (comprimido, si el server comprimió) — es más preciso
 * que el header `Content-Length`, que `next start` no manda en las
 * respuestas de chunk (van con `Transfer-Encoding: chunked`). Si por lo que
 * sea `sizes()` no devuelve nada útil, se cae al gzip manual del cuerpo
 * decodificado, tal como pide plan-operacion §6.4.
 */
async function collectScriptResponses(
  page: Page,
  path: string
): Promise<ScriptSample[]> {
  const samples: ScriptSample[] = [];
  const pending: Promise<void>[] = [];

  const onResponse = (response: Response): void => {
    const url = response.url();
    if (!url.startsWith(SAME_ORIGIN)) return;
    if (response.request().resourceType() !== "script") return;

    pending.push(
      (async () => {
        let size = 0;
        try {
          const sizes = await response.request().sizes();
          size = sizes.responseBodySize;
        } catch {
          // el request pudo cortarse (navegación) antes de resolver — se
          // intenta el fallback de abajo.
        }
        if (!size) {
          try {
            const body = await response.body();
            const contentEncoding = response.headers()["content-encoding"];
            size = contentEncoding?.includes("gzip")
              ? body.length
              : gzipSync(body).length;
          } catch {
            // respuesta ya descartada por el navegador — no se puede medir,
            // no se cuenta (mejor subestimar que reventar el spec por un
            // recurso que ni siquiera importa al presupuesto).
          }
        }
        samples.push({ url, sizeBytes: size });
      })()
    );
  };

  page.on("response", onResponse);
  await page.goto(path, { waitUntil: "networkidle" });
  await Promise.all(pending);
  page.off("response", onResponse);

  return samples;
}

function assertBudget(
  samples: ScriptSample[],
  label: string,
  limitKb: number
): void {
  const totalBytes = samples.reduce((acc, s) => acc + s.sizeBytes, 0);
  const totalKb = totalBytes / 1024;

  if (totalKb > limitKb) {
    const top5 = [...samples]
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
      .slice(0, 5)
      .map(
        (s) =>
          `  ${(s.sizeBytes / 1024).toFixed(1)} KB  ${s.url.replace(SAME_ORIGIN, "")}`
      )
      .join("\n");
    throw new Error(
      `Presupuesto de JS excedido en "${label}": ${totalKb.toFixed(1)} KB > ${limitKb} KB.\n` +
        `Los 5 chunks más grandes:\n${top5}`
    );
  }

  expect(totalKb).toBeLessThanOrEqual(limitKb);
  expect(samples.length).toBeGreaterThan(0);
  console.log(`${label}: ${totalKb.toFixed(1)} KB compressed scripts`);
}

test.describe("presupuesto de JS por página", () => {
  test("home", async ({ page }) => {
    const samples = await collectScriptResponses(page, "/");
    assertBudget(samples, "home", BUDGET_KB.home);
  });

  test("producto", async ({ page, browser }) => {
    await page.goto("/");
    await page.getByTestId(TESTIDS.headerCategoryLink).first().click();
    await expect(page).toHaveURL(/\/categoria\//);

    const productHref = await page
      .getByTestId(TESTIDS.productCard)
      .first()
      .getAttribute("href");
    if (!productHref)
      throw new Error(
        "El seed no tiene ningún producto — corré `pnpm db:seed`."
      );

    // La medición va en una pestaña **nueva**: navegar hasta acá desde la home
    // deja los chunks compartidos en el caché del navegador, y entonces
    // `responseBodySize` de cada uno vuelve 0 y el presupuesto de esta página
    // mide menos de 2 KB — un techo que no puede fallar nunca. La primera
    // visita de una compradora que llega por un link de WhatsApp tampoco tiene
    // nada cacheado, así que el contexto limpio es además el caso real.
    const context = await browser.newContext();
    try {
      const samples = await collectScriptResponses(
        await context.newPage(),
        productHref
      );
      assertBudget(samples, "producto", BUDGET_KB.producto);
    } finally {
      await context.close();
    }
  });

  test("checkout", async ({ page }) => {
    const samples = await collectScriptResponses(page, "/checkout");
    assertBudget(samples, "checkout", BUDGET_KB.checkout);
  });
});
