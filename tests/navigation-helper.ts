import type { Page } from "@playwright/test";

/** Open the navigation appropriate to the current viewport before choosing a category. */
export async function openFirstCategory(page: Page) {
  const mobile = page.getByTestId("header-menu-trigger");
  if (await mobile.isVisible()) await mobile.click();
  else await page.getByTestId("header-categories-trigger").click();
  await page
    .locator('[data-testid="header-category-link"]:visible')
    .first()
    .click();
}
