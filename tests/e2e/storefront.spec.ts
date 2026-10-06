import { expect, test } from "@playwright/test";

test("the storefront renders real HTML, styles, scripts and preparation help pages", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect((await response!.body()).length).toBeGreaterThan(5000);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Encontrá lo que va con vos."
  );
  expect(
    await page
      .locator(".store-hero")
      .evaluate((element) => getComputedStyle(element).backgroundColor)
  ).not.toBe("rgba(0, 0, 0, 0)");
  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((item) => item.name)
  );
  expect(resources.some((url) => url.includes(".css"))).toBe(true);
  expect(resources.some((url) => url.includes(".js"))).toBe(true);
  for (const path of [
    "/envios",
    "/devoluciones",
    "/preguntas-frecuentes",
    "/privacidad",
    "/contacto",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (path === "/contacto")
      await expect(page.locator("main")).toContainText("WhatsApp");
    else
      await expect(page.locator("main")).toContainText(
        /preparación|preparando/
      );
  }
  expect(errors).toEqual([]);
});

test("mobile search and category navigation fit the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("combobox", { name: /buscar/i }).filter({ visible: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(390);
  const category = page.getByTestId("header-category-link").first();
  await category.click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(390);
});
