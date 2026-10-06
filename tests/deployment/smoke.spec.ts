import { expect, test } from "@playwright/test";

test("production without a database renders HTML, CSS and JS with no demonstration catalog", async ({
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
  await expect(page.getByTestId("header-category-link")).toHaveCount(6);
  await expect(page.getByTestId("product-card")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Vista previa local");
  await expect(page.locator("body")).not.toContainText("DEMO");
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
  expect(errors).toEqual([]);
});

test("empty category, search and help routes remain usable on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/categoria/hogar-y-cocina",
    "/categoria/herramientas-y-jardin",
    "/categoria/tecnologia-y-accesorios",
    "/categoria/belleza-y-cuidado-personal",
    "/categoria/mascotas",
    "/categoria/deportes-y-aire-libre",
    "/buscar?q=auriculares",
    "/contacto",
    "/envios",
    "/devoluciones",
    "/preguntas-frecuentes",
    "/privacidad",
    "/terminos",
  ]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);
  }
});

test("health is honest JSON, private version is protected, and preview images are disabled", async ({
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.headers()["content-type"]).toContain("application/json");
  expect(await health.json()).toEqual({ ok: true, db: false, cron: false });
  expect((await request.get("/api/version")).status()).toBe(401);
  // Native fetch keeps the private Authorization header out of browser traces.
  const version = await fetch("http://127.0.0.1:3102/api/version", {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(version.status).toBe(200);
  const build = await version.json();
  expect(build.sha).toMatch(/^[a-f0-9]{7,40}$/);
  expect(build.node).toMatch(/^v22\./);
  expect(Number.isNaN(Date.parse(build.builtAt))).toBe(false);
  expect((await request.get("/api/preview-image/auriculares")).status()).toBe(
    404
  );
  expect(
    (await request.get("/producto/demo-auriculares")).status()
  ).toBeGreaterThanOrEqual(400);
});
