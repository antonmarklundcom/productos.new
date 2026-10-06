import { expect, test } from "@playwright/test";
import path from "node:path";

test("local production preview has six categories, artwork and a responsive rendered storefront", async ({
  page,
}, testInfo) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect((await response!.body()).length).toBeGreaterThan(5000);
  await expect(
    page.getByText("Vista previa local", { exact: false })
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Encontrá lo que va con vos."
  );
  await expect(page.getByTestId("header-category-link")).toHaveCount(6);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(page.locator(".store-product-card img").first()).toBeVisible();
  await expect(page.getByTestId("product-card")).toHaveCount(1);
  await expect(page.getByTestId("product-card")).toContainText(/149\.000/);
  expect(
    await page
      .locator(".store-product-card img")
      .first()
      .evaluate((image) => (image as HTMLImageElement).naturalWidth)
  ).toBeGreaterThan(0);
  await page.screenshot({
    path: path.resolve(
      "playwright-report",
      `home-${testInfo.project.name}.png`
    ),
    fullPage: true,
  });
});

test("search, category, product and empty cart work while showcase examples cannot be bought", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const search = page.locator('input[name="q"]:visible');
  await search.fill("auriculares");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/buscar\?q=auriculares/);
  await expect(page.getByTestId("product-card")).toHaveCount(1);
  await page.getByTestId("product-card").click();
  await expect(page).toHaveURL(/\/producto\/demo-auriculares/);
  await expect(page.locator("main")).toContainText("No está a la venta");
  await expect(page.getByTestId("product-add-to-cart")).toHaveCount(0);
  await expect(
    page.getByText("Precio ilustrativo", { exact: true })
  ).toBeVisible();
  await expect(page.locator(".demo-price strong")).toHaveText(/149\.000/);
  await page.getByRole("button", { name: "Ver imagen 2", exact: true }).click();
  await expect(page.locator(".gallery-main img")).toHaveAttribute(
    "src",
    /auriculares-lifestyle/
  );
  await page.getByRole("button", { name: "Ver imagen 1", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Comprar ahora · Demo" })
  ).toBeDisabled();
  await page.getByRole("button", { name: /Ampliar imagen/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar imagen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Ampliar imagen/ })
  ).toBeFocused();
  await page
    .getByText("¿Puedo comprar este producto?", { exact: true })
    .click();
  await expect(page.locator("details[open]")).toContainText("No se cobra");
  const ld = await page
    .locator('main script[type="application/ld+json"]')
    .allTextContents();
  expect(ld.join(" ")).not.toContain('"offers"');
  expect(ld.join(" ")).not.toContain('"price"');
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
  });
  await expect(page.locator(".gallery-main")).toBeInViewport();
  await page.screenshot({
    path: path.resolve(
      "playwright-report",
      `product-${testInfo.project.name}.png`
    ),
    fullPage: true,
    style:
      ".store-header, .product-gallery { position: static !important; } .skip-link { visibility: hidden !important; }",
  });
  await page.getByTestId("header-category-link").first().click();
  await expect(page.getByTestId("product-card")).toHaveCount(0);
  await page.goto("/categoria/tecnologia-y-accesorios");
  await expect(page.getByTestId("product-card")).toHaveCount(1);
  await page.getByTestId("header-cart-link").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("cart-checkout-link")).toHaveCount(0);
});
