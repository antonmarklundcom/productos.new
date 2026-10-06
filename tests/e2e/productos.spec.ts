import { expect, test } from "@playwright/test";

import { TESTIDS } from "./testids";

/**
 * El panel de productos y categorías (O7/S10, plan-operacion §6.2): crear un
 * producto con descripción en markdown, ver la vista previa, duplicarlo y
 * aplicar una acción masiva sobre la copia.
 *
 * Como `panel.spec.ts`, hace su propio login: con `fullyParallel` el orden
 * entre specs no está garantizado (fable/plan.md §6.1 — "preferir
 * independencia"). Todo se ubica por `data-testid`, nunca por texto ni por
 * el catálogo sembrado (NEW-STORE.md §5): el nombre del producto lo inventa
 * este spec.
 */
test("crear producto con markdown, duplicarlo y desactivar la copia en masa", async ({ page }) => {
  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;
  if (!ownerEmail || !ownerPassword) {
    throw new Error(
      "Faltan OWNER_EMAIL/OWNER_PASSWORD en el entorno del test — son los mismos que usó " +
        "`pnpm create-owner` (o `POST /api/setup/init`) para sembrar la cuenta del dueño."
    );
  }

  const nombreProducto = `Producto E2E ${Date.now()}`;

  await page.goto("/admin/login?next=%2Fadmin%2Fproductos%2Fnuevo");
  await page.getByTestId(TESTIDS.adminLoginEmail).fill(ownerEmail);
  await page.getByTestId(TESTIDS.adminLoginPassword).fill(ownerPassword);
  await page.getByTestId(TESTIDS.adminLoginSubmit).click();
  await page.waitForURL(/\/admin\/productos\/nuevo$/);

  // --- Alta con descripción en markdown ------------------------------------
  await page.getByTestId(TESTIDS.adminProductNameInput).fill(nombreProducto);
  await page
    .getByTestId(TESTIDS.adminMarkdownTextarea)
    .fill("**Importado** de Brasil.\n\n- Talle M\n- Talle L");

  // Vista previa: el markdown se renderizó en el cliente, sin ir al servidor.
  await page.getByTestId(TESTIDS.adminMarkdownTabPreview).click();
  const preview = page.getByTestId(TESTIDS.adminMarkdownPreview);
  await expect(preview.locator("strong")).toHaveText("Importado");
  await expect(preview.locator("li")).toHaveCount(2);
  // El input original no debería colarse crudo: si el escape fallara, un
  // `<script>` en la descripción terminaría ejecutándose acá mismo.
  await expect(preview.locator("script")).toHaveCount(0);

  await page.getByTestId(TESTIDS.adminMarkdownTabEdit).click();

  await page.getByTestId(TESTIDS.adminProductSaveSubmit).click();
  await page.waitForURL(/\/admin\/productos\/\d+$/);
  const productUrl = page.url();
  const productId = productUrl.split("/").pop();

  // --- Duplicar -------------------------------------------------------------
  // Ya estamos en `/admin/productos/{productId}`, que matchea el mismo
  // patrón al que redirige la copia: un `waitForURL` con sólo el patrón
  // resolvería de inmediato contra la URL ya puesta, sin esperar la
  // navegación real. Por eso el predicado exige, además, que cambie.
  await Promise.all([
    page.waitForURL((url) => url.href !== productUrl && /\/admin\/productos\/\d+$/.test(url.pathname)),
    page.getByTestId(TESTIDS.adminProductDuplicate).click(),
  ]);
  const copyUrl = page.url();
  expect(copyUrl).not.toBe(productUrl);
  const copyId = copyUrl.split("/").pop();
  expect(copyId).not.toBe(productId);

  // --- Acción masiva sobre la copia ------------------------------------------
  await page.goto(`/admin/productos?q=${encodeURIComponent(nombreProducto)}`);
  // La búsqueda por nombre trae el original y la copia (el nombre de la copia
  // lo arma `duplicateProduct` agregándole "(copia)" al final): se elige nada
  // más que la fila de la copia por su id, con el mismo `data-id` que acaba
  // de confirmar la redirección de arriba.
  await page
    .locator(`[data-testid="${TESTIDS.adminProductRowSelect}"][data-id="${copyId}"]`)
    .check();

  await expect(page.getByTestId(TESTIDS.adminBulkBar)).toBeVisible();
  await page.getByTestId(TESTIDS.adminBulkActivate).click();

  await expect(page.getByTestId(TESTIDS.adminBulkBar)).toHaveCount(0);
});

/**
 * Destacados (O14 dejó `isFeatured` en el dominio; S17 dibuja el toggle) —
 * fable/plan-crecimiento.md §6.1 A/G.
 *
 * Verifica contra `/admin/productos?destacados=1` (`force-dynamic`, siempre
 * fresco) y no contra la home pública: `saveProduct` no revalidea `/` —a
 * diferencia de `crearCategoria`/`editarCategoria`, que sí llaman
 * `revalidatePath("/", "layout")`— así que la home queda con el ISR viejo
 * (`revalidate = 300`) hasta el próximo pedido de esa ruta después de la
 * ventana. Documentado en `KNOWN-ISSUES.md` con el arreglo (agregar el mismo
 * `revalidatePath` a `src/app/actions/admin-products.ts`, fuera del alcance
 * de S17 — `src/app/actions/**` es límite duro).
 */
test("marcar un producto como destacado lo muestra en el filtro del panel", async ({ page }) => {
  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;
  if (!ownerEmail || !ownerPassword) {
    throw new Error(
      "Faltan OWNER_EMAIL/OWNER_PASSWORD en el entorno del test — son los mismos que usó " +
        "`pnpm create-owner` (o `POST /api/setup/init`) para sembrar la cuenta del dueño."
    );
  }

  const nombreProducto = `Destacado E2E ${Date.now()}`;

  await page.goto("/admin/login?next=%2Fadmin%2Fproductos%2Fnuevo");
  await page.getByTestId(TESTIDS.adminLoginEmail).fill(ownerEmail);
  await page.getByTestId(TESTIDS.adminLoginPassword).fill(ownerPassword);
  await page.getByTestId(TESTIDS.adminLoginSubmit).click();
  await page.waitForURL(/\/admin\/productos\/nuevo$/);

  await page.getByTestId(TESTIDS.adminProductNameInput).fill(nombreProducto);
  await page.getByTestId(TESTIDS.adminProductFeaturedToggle).check();

  await page.getByTestId(TESTIDS.adminProductSaveSubmit).click();
  await page.waitForURL(/\/admin\/productos\/\d+$/);
  const productId = page.url().split("/").pop();

  // El filtro "sólo destacados" (`listAdminProducts({ featured: true })`)
  // lo trae, y la fila muestra el chip — ubicado por `data-id`, nunca por el
  // nombre que este mismo spec inventó (NEW-STORE.md §5).
  await page.goto("/admin/productos?destacados=1");
  const row = page
    .locator(`[data-testid="${TESTIDS.adminProductRowSelect}"][data-id="${productId}"]`)
    .locator("xpath=ancestor::li[1]");
  await expect(row).toBeVisible();
  await expect(row.getByTestId(TESTIDS.adminProductFeaturedChip)).toBeVisible();
});
