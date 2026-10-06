import { expect, test } from "@playwright/test";

import { loginAsOwner } from "./helpers";

test("owner navigation opens every admin screen without the panel error", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loginAsOwner(page);
  const nav = page.locator("aside").getByRole("navigation");
  const destinations = await nav
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(destinations).toHaveLength(14);
  for (const href of destinations) {
    if (!href) throw new Error("Admin link is missing its destination");
    const response = await page.goto(href);
    expect(response?.status(), href).toBe(200);
    await expect(
      page.getByText("Algo falló en el panel", { exact: true }),
      href
    ).toHaveCount(0);
    await expect(
      page.locator("aside").getByRole("link", { name: "Pedidos", exact: true })
    ).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
  }
  await page.goto("/admin");
  await page.screenshot({
    path: "playwright-report/capturas/admin-sidebar-desktop.png",
    fullPage: true,
  });
});

test("menu changes persist, can be cancelled, and work in the mobile drawer", async ({
  page,
}) => {
  await loginAsOwner(page);
  const nav = page.locator("aside").getByRole("navigation");
  const original = await nav.getByRole("link").allTextContents();
  await page.getByRole("button", { name: "Editar menú", exact: true }).click();
  await page
    .getByRole("button", { name: "Subir Pedidos", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Guardar orden", exact: true })
    .click();
  await page.reload();
  await expect(nav.getByRole("link").first()).toHaveText("Pedidos");
  await page.getByRole("button", { name: "Editar menú", exact: true }).click();
  await page
    .getByRole("button", { name: "Restaurar orden original", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(nav.getByRole("link").first()).toHaveText("Pedidos");
  await page.getByRole("button", { name: "Editar menú", exact: true }).click();
  await page
    .getByRole("button", { name: "Restaurar orden original", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Guardar orden", exact: true })
    .click();
  await expect(nav.getByRole("link")).toHaveText(original);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("aside")).toBeHidden();
  const trigger = page.getByRole("button", { name: "Abrir menú del panel" });
  await trigger.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await page.screenshot({
    path: "playwright-report/capturas/admin-sidebar-mobile.png",
  });
  await drawer.getByRole("link", { name: "Productos", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/productos$/);
  await expect(drawer).toBeHidden();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});
