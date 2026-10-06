import { expect, test } from "@playwright/test";

import { loginAsOwner, openOrderFicha, realizarCompra } from "./helpers";
import { TESTIDS } from "./testids";

/**
 * Capturas de pantalla por PR (plan-operacion §6.4). No cuidan ninguna
 * regla — son para que Anton (o quien revise el PR) vea cómo quedó la
 * pantalla sin tener que levantar el entorno. Van al artifact de CI
 * (`playwright-report/capturas/`), nunca a git (`.gitignore`).
 *
 * Dos anchos: 390 (celular, donde compra la mayoría en Paraguay) y 1280
 * (desktop, donde vive el panel). Seis páginas: las que más cambian de PR a
 * PR en las fases de piel de este plan.
 */
const WIDTHS = [390, 1280] as const;

async function screenshot(
  page: import("@playwright/test").Page,
  name: string,
  width: number
): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  // The URL changes before streamed content and the cart exit animation finish.
  await expect(page.locator('main h1').first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (name === 'checkout-con-carrito') {
    await expect(page.getByTestId(TESTIDS.checkoutName)).toBeVisible();
  }
  await page.screenshot({
    path: `playwright-report/capturas/${name}-${width}.png`,
    fullPage: true,
  });
}

test.describe("capturas por PR", () => {
  for (const width of WIDTHS) {
    test(`home @ ${width}`, async ({ page }) => {
      await page.goto("/");
      await screenshot(page, "home", width);
    });

    test(`categoria @ ${width}`, async ({ page }) => {
      await page.goto("/");
      await page.getByTestId(TESTIDS.headerCategoryLink).first().click();
      await expect(page).toHaveURL(/\/categoria\//);
      await screenshot(page, "categoria", width);
    });

    test(`producto @ ${width}`, async ({ page }) => {
      await page.goto("/");
      await page.getByTestId(TESTIDS.headerCategoryLink).first().click();
      await page.getByTestId(TESTIDS.productCard).first().click();
      await expect(page).toHaveURL(/\/producto\//);
      await screenshot(page, "producto", width);
    });

    test(`checkout con carrito @ ${width}`, async ({ page }) => {
      await page.goto("/");
      await page.getByTestId(TESTIDS.headerCategoryLink).first().click();
      await page.getByTestId(TESTIDS.productCard).first().click();
      await page.getByTestId(TESTIDS.productAddToCart).click();
      await page.getByTestId(TESTIDS.cartCheckoutLink).click();
      await expect(page).toHaveURL(/\/checkout/);
      await screenshot(page, "checkout-con-carrito", width);
    });

    test(`admin pedidos @ ${width}`, async ({ page }) => {
      await loginAsOwner(page);
      await screenshot(page, "admin-pedidos", width);
    });

    test(`ficha de pedido @ ${width}`, async ({ page }) => {
      // Un pedido propio del test: no depende de que otro spec haya corrido
      // antes ni de datos del seed (mismo criterio que `panel.spec.ts`).
      const { orderNumber } = await realizarCompra(page);
      await loginAsOwner(page);
      await openOrderFicha(page, orderNumber);
      await screenshot(page, "ficha-pedido", width);
    });
  }
});
