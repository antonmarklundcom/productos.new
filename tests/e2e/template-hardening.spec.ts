import { expect, test } from "@playwright/test";
import { TESTIDS } from "./testids";

test("mobile enquiry selects out-of-stock variants by keyboard, with no prices or purchase offer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/producto/browser-enquiry");
  await expect(
    page.getByRole("heading", { name: "Browser enquiry", exact: true })
  ).toBeVisible();
  const large = page.getByRole("button", { name: "Large", exact: true });
  await large.focus();
  await page.keyboard.press("Enter");
  const inquiry = page.getByTestId("variant-inquiry-link");
  await expect(inquiry).toHaveAttribute("href", /browser-enquiry-Large/);
  await expect(page.getByTestId(TESTIDS.productAddToCart)).toHaveCount(0);
  const detail = page
    .getByRole("heading", { name: "Browser enquiry", exact: true })
    .locator("..");
  await expect(detail).not.toContainText("₲");
  const ld = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  expect(
    ld
      .map((json) => JSON.parse(json))
      .find((record) => record["@type"] === "Product")
  ).not.toHaveProperty("offers");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});

test("showcase has no purchase offer and stock products retain their purchase selector", async ({
  page,
}) => {
  await page.goto("/producto/browser-showcase");
  await expect(
    page.getByRole("heading", { name: "Browser showcase", exact: true })
  ).toBeVisible();
  await expect(page.getByTestId(TESTIDS.productAddToCart)).toHaveCount(0);
  await page.goto("/producto/browser-stock");
  await expect(page.getByTestId(TESTIDS.productAddToCart)).toBeEnabled();
});

test("recovery of an order does not expose the private link using a phone number", async ({
  page,
}) => {
  await page.goto("/pedido/buscar");
  const form = page.locator("main form");
  await form.locator('input[name="orderNumber"]').fill("PY-123456");
  await form.locator('input[name="phone"]').fill("0981123456");
  await form.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/pedido\/buscar$/);
  await expect(form).toContainText("Revisá WhatsApp");
  expect(await form.textContent()).not.toContain("token=");
});
