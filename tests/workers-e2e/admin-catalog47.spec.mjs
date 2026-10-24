import { test, expect } from "@playwright/test";
import sharp from "sharp";
import {
  createHarness,
  restrictBrowser,
  fixturePassword,
} from "../../scripts/workers-browser-harness.mjs";
let h;
test.use({ actionTimeout: 15000, navigationTimeout: 20000 });
test.beforeEach(async ({ context, page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  h = await createHarness();
  await restrictBrowser(context, h.baseURL);
});
test.afterEach(async ({ context }) => {
  const bounded = async (promise, label) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(label + " exceeded 15 seconds")),
            15000
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  // Both ends must close together so in-flight browser streams cannot hold
  // either disposer open while it waits for the other side to disappear.
  await Promise.all([
    bounded(context.close(), "Synthetic browser context close"),
    bounded(h?.close(), "Synthetic harness disposal"),
  ]);
});
async function login(page, role = "owner") {
  await page.goto(h.baseURL + "/admin/login", { waitUntil: "networkidle" });
  await page.getByTestId("admin-login-email").fill(role + "@fixture.invalid");
  await page.getByTestId("admin-login-password").fill(fixturePassword);
  await page.getByTestId("admin-login-submit").click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
  await page.waitForLoadState("networkidle");
}
async function scalar(sql, column) {
  let timer;
  try {
    return await Promise.race([
      h.db
        .prepare(sql)
        .first()
        .then((row) => row?.[column]),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Synthetic D1 read exceeded 5 seconds")),
          5000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function imageFile(name = "fixture.png", color = "#286c48") {
  return {
    name,
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 80, height: 60, channels: 3, background: color },
    })
      .png()
      .toBuffer(),
  };
}
async function productUpload(page, name, expectedCount) {
  await page.locator("input#file").setInputFiles(await imageFile(name));
  await page.locator("input#alt").fill(name);
  await page
    .locator("input#file")
    .locator("xpath=ancestor::form")
    .getByRole("button", { name: /subir/i })
    .click();
  await expect
    .poll(() =>
      scalar("SELECT COUNT(*) n FROM product_images WHERE product_id=1", "n")
    )
    .toBe(expectedCount);
  await expect(
    page
      .locator("input#file")
      .locator("xpath=ancestor::form")
      .getByRole("button", { name: /subir/i })
  ).toBeEnabled();
}

test("owner filtered CSV download contains only allowlisted rows and direct staff replay is denied", async ({
  page,
  browser,
}) => {
  await h.db
    .prepare(
      "INSERT INTO supplier_offers(variant_id,unit_cost_pyg,source,notes,is_active,is_confirmed,is_preferred) VALUES(1,12000,'CSV allowlisted source','CSV_PRIVATE_NOTE_NEVER_EXPORT',1,1,1)"
    )
    .run();
  await h.db.prepare("UPDATE variants SET label='=2+2' WHERE id=1").run();
  await login(page);
  await page.goto(h.baseURL + "/admin/productos?q=Synthetic%20visible", {
    waitUntil: "networkidle",
  });
  let action;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"])
      action = request;
  });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /descargar csv/i }).click();
  const download = await downloaded;
  const chunks = [];
  for await (const chunk of await download.createReadStream())
    chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain("SYNTH-1");
  expect(csv).toContain("'=2+2");
  expect(csv).toContain("CSV allowlisted source");
  expect(csv).not.toContain("SYNTH-2");
  expect(csv).not.toContain("SYNTH-3");
  expect(csv).not.toContain("CSV_PRIVATE_NOTE_NEVER_EXPORT");
  expect(download.suggestedFilename()).toMatch(/productos.*\.csv$/);
  expect(action).toBeTruthy();
  const staff = await browser.newContext();
  try {
    await restrictBrowser(staff, h.baseURL);
    const other = await staff.newPage();
    await login(other, "staff");
    await other.goto(h.baseURL + "/admin/productos", {
      waitUntil: "networkidle",
    });
    expect(
      await other.getByRole("button", { name: /descargar csv/i }).count()
    ).toBe(0);
    const denied = await other.evaluate(
      async (input) => {
        const response = await fetch(input.url, {
          method: "POST",
          headers: input.headers,
          credentials: "include",
          body: input.body,
        });
        return { status: response.status, text: await response.text() };
      },
      {
        url: h.baseURL + "/admin/productos",
        headers: {
          accept: "text/x-component",
          "next-action": action.headers()["next-action"],
          ...(action.headers()["x-rsc-action"]
            ? { "x-rsc-action": action.headers()["x-rsc-action"] }
            : {}),
          "content-type": action.headers()["content-type"],
        },
        body: action.postData(),
      }
    );
    expect(
      denied.status >= 400 ||
        /permiso|no puede hacer|autoriz|sesión|iniciar|dueño/i.test(denied.text)
    ).toBe(true);
    expect(denied.text).not.toContain("CSV_PRIVATE_NOTE_NEVER_EXPORT");
  } finally {
    await staff.close();
  }
});

test("category prepared R2 upload is independent and its acknowledgement coordinates the dirty category draft", async ({
  page,
}) => {
  await login(page);
  await page.goto(h.baseURL + "/admin/categorias", {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.locator("#categoria-name").fill("Synthetic categoría editada");
  await page.getByRole("button", { name: /guardar cambios/i }).click();
  await expect
    .poll(() => scalar("SELECT name FROM categories WHERE id=1", "name"))
    .toBe("Synthetic categoría editada");
  await expect(
    page.getByText("Synthetic categoría editada", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page
    .locator("#categoria-description")
    .fill("Borrador conservado durante la foto");
  const file = page.getByTestId("admin-category-image-input");
  await file.setInputFiles(await imageFile("category.png"));
  const form = file.locator("xpath=ancestor::form");
  await form.locator('input[name="alt"]').fill("Foto sintética de categoría");
  await form.getByRole("button", { name: /subir/i }).click();
  await expect
    .poll(() =>
      scalar(
        "SELECT image_cloudinary_id FROM categories WHERE id=1",
        "image_cloudinary_id"
      )
    )
    .toMatch(/^r2:/);
  expect(
    await scalar("SELECT description FROM categories WHERE id=1", "description")
  ).toBeNull();
  await expect(page.locator("#categoria-description")).toHaveValue(
    "Borrador conservado durante la foto"
  );
  await page.getByRole("button", { name: /guardar cambios/i }).click();
  await expect
    .poll(() =>
      scalar("SELECT description FROM categories WHERE id=1", "description")
    )
    .toBe("Borrador conservado durante la foto");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.getByAltText("Foto sintética de categoría")).toBeVisible();
  await expect(page.locator("#categoria-description")).toHaveValue(
    "Borrador conservado durante la foto"
  );
  const saved = await h.db
    .prepare("SELECT image_cloudinary_id FROM categories WHERE id=1")
    .first();
  const prefix = saved.image_cloudinary_id.slice(3).split("@")[0];
  expect((await h.bucket.list({ prefix })).objects.length).toBeGreaterThan(0);
});

test("gallery alt cover order and refresh-persistent undo preserve same-editor product saves", async ({
  page,
}) => {
  await login(page);

  await page.goto(h.baseURL + "/admin/productos/1", {
    waitUntil: "networkidle",
  });
  await page
    .getByTestId("admin-product-name-input")
    .fill("Same editor after photo");
  await productUpload(page, "Primera foto", 1);

  await page.getByTestId("admin-product-save-submit").click();
  await expect
    .poll(() => scalar("SELECT name FROM products WHERE id=1", "name"))
    .toBe("Same editor after photo");

  await productUpload(page, "Segunda foto", 2);

  const first = await h.db
    .prepare(
      "SELECT id FROM product_images WHERE product_id=1 ORDER BY position,id"
    )
    .first();
  const second = await h.db
    .prepare(
      "SELECT id FROM product_images WHERE product_id=1 ORDER BY position DESC,id DESC"
    )
    .first();
  await page
    .getByRole("textbox", { name: "Descripción de foto 1", exact: true })
    .fill("Descripción corregida");
  await page.getByRole("heading", { name: /fotos/i }).click();
  await expect
    .poll(() =>
      scalar(`SELECT alt FROM product_images WHERE id=${first.id}`, "alt")
    )
    .toBe("Descripción corregida");

  await page
    .getByRole("button", { name: "Usar de portada", exact: true })
    .nth(1)
    .click();
  await expect
    .poll(() =>
      scalar(
        "SELECT id FROM product_images WHERE product_id=1 ORDER BY position,id LIMIT 1",
        "id"
      )
    )
    .toBe(second.id);

  // The durable write can commit before refreshed gallery props reach React.
  // Remove the intended cover only after its UI readback matches that order.
  await expect(
    page.getByRole("textbox", { name: "Descripción de foto 1", exact: true })
  ).toHaveValue("Segunda foto");
  const cover = page.locator("li").filter({
    has: page.getByRole("textbox", {
      name: "Descripción de foto 1",
      exact: true,
    }),
  });
  await cover.getByRole("button", { name: /quitar/i }).click();
  await expect
    .poll(() =>
      scalar("SELECT COUNT(*) n FROM product_images WHERE product_id=1", "n")
    )
    .toBe(1);

  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /^Deshacer: Segunda foto/ }).click();

  await expect
    .poll(() =>
      scalar("SELECT COUNT(*) n FROM product_images WHERE product_id=1", "n")
    )
    .toBe(2);

  expect(
    await scalar(
      "SELECT id FROM product_images WHERE product_id=1 ORDER BY position,id LIMIT 1",
      "id"
    )
  ).toBe(second.id);
  await page
    .getByTestId("admin-product-name-input")
    .fill("Same editor after undo");
  await page.getByTestId("admin-product-save-submit").click();
  await expect
    .poll(() => scalar("SELECT name FROM products WHERE id=1", "name"))
    .toBe("Same editor after undo");
  await page.reload({ waitUntil: "networkidle" });

  expect(
    await scalar(`SELECT alt FROM product_images WHERE id=${first.id}`, "alt")
  ).toBe("Descripción corregida");
});

test("bounded bulk hide show and safe duplication execute through actual built action bindings", async ({
  page,
}) => {
  await login(page);
  await page.goto(h.baseURL + "/admin/productos", { waitUntil: "networkidle" });
  const checkbox = page.locator(
    '[data-testid="admin-product-row-select"][data-id="1"]'
  );
  await checkbox.check();
  await page.getByTestId("admin-bulk-deactivate").click();
  await expect
    .poll(() =>
      scalar("SELECT is_active FROM products WHERE id=1", "is_active")
    )
    .toBe(0);
  await expect(checkbox.locator("xpath=ancestor::li")).toContainText(
    /sin publicar/i
  );
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await page.getByTestId("admin-bulk-activate").click();
  await expect
    .poll(() =>
      scalar("SELECT is_active FROM products WHERE id=1", "is_active")
    )
    .toBe(1);
  await page.goto(h.baseURL + "/admin/productos/1", {
    waitUntil: "networkidle",
  });
  await page.getByTestId("admin-product-duplicate").click();
  await page.waitForURL((url) =>
    /\/admin\/productos\/[4-9][0-9]*$/.test(url.pathname)
  );
  const id = Number(new URL(page.url()).pathname.split("/").at(-1));
  expect(id).toBeGreaterThan(3);
  const copy = await h.db
    .prepare("SELECT published_at,sale_mode FROM products WHERE id=?")
    .bind(id)
    .first();
  expect(copy.published_at).toBeNull();
  expect(copy.sale_mode).toBe("enquiry");
  expect(
    await scalar(
      `SELECT COALESCE(SUM(on_hand),0) n FROM variants WHERE product_id=${id}`,
      "n"
    )
  ).toBe(0);
  expect(
    await scalar(
      `SELECT COUNT(*) n FROM product_images WHERE product_id=${id}`,
      "n"
    )
  ).toBe(0);
});

test("staged file prepares without publication and publishes atomically through its explicit native button", async ({
  page,
}) => {
  await login(page);
  await page.goto(h.baseURL + "/admin/productos", { waitUntil: "networkidle" });
  await page.getByLabel(/Preparar y publicar la planilla completa/).check();
  const csv =
    "Producto,Categoría,SKU,Variante,Precio,Stock,Modo de venta,Mostrar precio\nZZ misión orbital,Synthetic,STAGED-47,Única,60000,0,enquiry,sí";
  await page.locator("input[type=file]").setInputFiles({
    name: "staged.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: /revisar/i }).click();
  await page.getByRole("button", { name: /confirmar e importar/i }).click();
  const publish = page.getByRole("button", {
    name: "Publicar planilla completa",
    exact: true,
  });
  await expect(publish).toBeVisible();
  expect(
    await scalar("SELECT COUNT(*) n FROM variants WHERE sku='STAGED-47'", "n")
  ).toBe(0);
  expect(
    await scalar(
      "SELECT COUNT(*) n FROM catalog_import_plans WHERE mode='staged' AND status='ready'",
      "n"
    )
  ).toBe(1);
  await publish.click();
  await expect
    .poll(() =>
      scalar("SELECT COUNT(*) n FROM variants WHERE sku='STAGED-47'", "n")
    )
    .toBe(1);
  expect(
    await scalar(
      "SELECT COUNT(*) n FROM catalog_import_plans WHERE mode='staged' AND status='published'",
      "n"
    )
  ).toBe(1);
  await page.reload({ waitUntil: "networkidle" });
  expect(
    await scalar("SELECT COUNT(*) n FROM variants WHERE sku='STAGED-47'", "n")
  ).toBe(1);
});
