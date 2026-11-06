import { test, expect } from "@playwright/test";
import { createHarness, restrictBrowser } from "../../scripts/workers-browser-harness.mjs";

test("mobile inquiry follows the variant and reports a handoff without navigating off-site", async ({ browser }) => {
  const h = await createHarness({ inquiryMetrics: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 620 } });
  try {
    await restrictBrowser(context, h.baseURL);
    await h.db.prepare("INSERT INTO variants(id,product_id,sku,label,price_pyg,is_active) VALUES(4,1,'SYNTH-4','Synthetic option two',54000,1)").run();
    const page = await context.newPage();
    const isMetric = (response) => new URL(response.url()).pathname === "/api/catalog/inquiry-metrics";
    const viewResponse = page.waitForResponse(isMetric);
    await page.goto(h.baseURL + "/producto/synthetic-visible");
    const view = await viewResponse;
    expect(view.status()).toBe(204);
    expect(view.request().postDataJSON()).toEqual({ event: "product_view", productId: 1 });

    const sticky = page.locator("[data-sticky-product-inquiry] a");
    await expect(sticky).toBeInViewport();
    await expect(sticky).toHaveAttribute("href", /SYNTH-1/);
    await expect(page.getByRole("link", { name: "Escribinos por WhatsApp" })).toBeHidden();

    await page.getByRole("button", { name: "Synthetic option two" }).click();
    await expect(page.locator("[data-product-inquiry]")).toHaveAttribute("href", /SYNTH-4/);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(sticky).toBeInViewport();
    await expect(sticky).toHaveAttribute("href", /SYNTH-4/);

    await page.evaluate(() => {
      window.addEventListener("click", (event) => event.preventDefault(), { once: true });
    });
    const clickResponse = page.waitForResponse(isMetric);
    await sticky.click();
    const click = await clickResponse;
    expect(click.status()).toBe(204);
    expect(click.request().postDataJSON()).toEqual({
      event: "whatsapp_click", productId: 1, placement: "sticky",
    });
    await expect(page).toHaveURL(h.baseURL + "/producto/synthetic-visible");
  } finally {
    await context.close();
    await h.close();
  }
});
