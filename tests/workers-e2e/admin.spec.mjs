import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { cifrarSecreto, descifrarSecreto } from "../../src/lib/secret-box.ts";
import {
  createHarness,
  restrictBrowser,
  fixturePassword,
  origin,
} from "../../scripts/workers-browser-harness.mjs";
let h;
test.beforeEach(async ({ context }) => {
  h = await createHarness();
  await restrictBrowser(context, h.baseURL);
});
test.afterEach(async () => {
  await h?.close();
});
async function login(
  page,
  role = "owner",
  password = fixturePassword,
  baseURL = h.baseURL
) {
  await page.goto(baseURL + "/admin/login", { waitUntil: "networkidle" });
  await page.getByTestId("admin-login-email").fill(role + "@fixture.invalid");
  await page.getByTestId("admin-login-password").fill(password);
  await page.getByTestId("admin-login-submit").click();
  await expect
    .poll(async () =>
      (await page.context().cookies()).some((c) => c.name === "ecom_admin")
    )
    .toBe(true);
  await page.waitForURL((url) => url.pathname !== "/admin/login");
  await page.waitForLoadState("networkidle");
}
async function count(sql) {
  return Number((await h.db.prepare(sql).first()).n);
}

test("authenticated owner/staff save readback, real multipart image and direct role/size denial", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.goto(h.baseURL + "/admin/productos/1", {
    waitUntil: "networkidle",
  });
  const captured = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"]) captured.push(r);
  });
  await page.getByTestId("admin-product-name-input").fill("Synthetic edited");
  await page.getByTestId("admin-product-save-submit").click();
  await expect
    .poll(() =>
      h.db
        .prepare("SELECT name FROM products WHERE id=1")
        .first()
        .then((r) => r.name)
    )
    .toBe("Synthetic edited");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByTestId("admin-product-name-input")).toHaveValue(
    "Synthetic edited"
  );
  const png = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#237d48" },
  })
    .png()
    .toBuffer();
  await page.locator("input#file").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page
    .locator("input#file")
    .locator("xpath=ancestor::form")
    .getByRole("button", { name: /subir/i })
    .click();
  await expect
    .poll(() =>
      count("SELECT COUNT(*) n FROM product_images WHERE product_id=1")
    )
    .toBe(1);
  const photo = await h.db
    .prepare("SELECT cloudinary_id FROM product_images WHERE product_id=1")
    .first();
  expect(photo.cloudinary_id).toMatch(/^r2:p1\//);
  const prefix = photo.cloudinary_id.slice(3).split("@")[0];
  const stored = await h.bucket.list({ prefix });
  expect(stored.objects.some((object) => object.key.endsWith(".jpg"))).toBe(
    true
  );
  expect(stored.objects.some((object) => object.key.endsWith(".webp"))).toBe(
    true
  );
  for (const object of stored.objects) {
    const saved = await h.bucket.get(object.key);
    const metadata = await sharp(
      Buffer.from(await saved.arrayBuffer())
    ).metadata();
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);
  }
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page
      .locator("button")
      .filter({ hasText: /quitar/i })
      .first()
  ).toBeVisible();
  const write = captured.find(
    (r) => !r.headers()["content-type"]?.includes("multipart")
  );
  expect(Boolean(write)).toBe(true);
  for (const role of ["staff", "vendedor"]) {
    const ctx = await browser.newContext();
    await restrictBrowser(ctx, h.baseURL);
    const other = await ctx.newPage();
    await login(other, role);
    if (role === "staff") {
      await other.goto(h.baseURL + "/admin/productos/1");
      await other
        .getByTestId("admin-product-name-input")
        .fill("Synthetic staff edit");
      await other.getByTestId("admin-product-save-submit").click();
      await expect
        .poll(() =>
          h.db
            .prepare("SELECT name FROM products WHERE id=1")
            .first()
            .then((r) => r.name)
        )
        .toBe("Synthetic staff edit");
    } else {
      const denied = await other.evaluate(
        async (input) => {
          const response = await fetch(input.url, {
            method: "POST",
            credentials: "include",
            headers: input.headers,
            body: input.body,
          });
          return { status: response.status, text: await response.text() };
        },
        {
          url: h.baseURL + "/admin/estado",
          headers: {
            accept: "text/x-component",
            "next-action": write.headers()["next-action"],
            ...(write.headers()["x-rsc-action"]
              ? { "x-rsc-action": write.headers()["x-rsc-action"] }
              : {}),
            "content-type": write.headers()["content-type"],
          },
          body: write.postData(),
        }
      );
      expect(
        denied.status >= 400 ||
          /permiso|no puede hacer|autoriz|sesión|iniciar/i.test(denied.text)
      ).toBe(true);
      expect(
        (await h.db.prepare("SELECT name FROM products WHERE id=1").first())
          .name
      ).toBe("Synthetic staff edit");
    }
    await ctx.close();
  }
  const large = await page.request.post(h.baseURL + "/admin/productos/1", {
    headers: { origin: h.baseURL, "content-type": "application/octet-stream" },
    data: Buffer.alloc(1048577),
  });
  expect(large.status()).toBe(413);
});

test("catalog import preview and confirm use actual client action references", async ({
  page,
}) => {
  await login(page);
  await page.goto(h.baseURL + "/admin/productos", { waitUntil: "networkidle" });
  const csv =
    "Producto,Categoría,SKU,Variante,Precio,Stock,Modo de venta,Mostrar precio\nSynthetic imported,Synthetic,SYNTH-IMPORTED,Única,60000,2,enquiry,sí";
  await page.locator("input[type=file]").setInputFiles({
    name: "synthetic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: /revisar/i }).click();
  const confirm = page.getByRole("button", { name: /confirmar e importar/i });
  await expect(confirm).toBeVisible();
  expect(
    await count("SELECT COUNT(*) n FROM variants WHERE sku='SYNTH-IMPORTED'")
  ).toBe(0);
  await confirm.click();
  await expect
    .poll(() =>
      count("SELECT COUNT(*) n FROM variants WHERE sku='SYNTH-IMPORTED'")
    )
    .toBe(1);
  await page.reload({ waitUntil: "networkidle" });
  expect(
    await count("SELECT COUNT(*) n FROM variants WHERE sku='SYNTH-IMPORTED'")
  ).toBe(1);
});

test("password recovery fragment validation replay expiry and old-context revocation", async ({
  page,
  browser,
}) => {
  await login(page);
  const recovery = await browser.newContext();
  await restrictBrowser(recovery, h.baseURL);
  const reset = await recovery.newPage();
  async function request(email) {
    await reset.goto(h.baseURL + "/admin/recuperar");
    await reset.locator("#email").fill(email);
    await reset.getByRole("button", { name: /enviar/i }).click();
    await expect(reset.locator("#message")).toContainText(
      "Si hay una cuenta activa"
    );
    return reset.locator("#message").innerText();
  }
  const unknown = await request("unknown@fixture.invalid");
  expect(h.mail.length).toBe(0);
  const known = await request("owner@fixture.invalid");
  expect(known).toBe(unknown);
  await expect.poll(() => h.mail.length).toBe(1);
  const link = h.mail.at(-1).text.match(/https:\/\/\S+#token=[a-f0-9]+/)[0];
  await reset.goto(link.replace(origin, h.baseURL));
  await expect.poll(() => new URL(reset.url()).hash === "").toBe(true);
  expect(await reset.locator("#reset-token").inputValue()).toMatch(
    /^[a-f0-9]{64}$/
  );
  const token = await reset.locator("#reset-token").inputValue();
  const invalid = await recovery.request.post(
    h.baseURL + "/admin/restablecer",
    {
      headers: { origin: h.baseURL },
      form: { token, password: "short", confirm: "short" },
    }
  );
  expect(invalid.status()).toBe(400);
  await reset.locator("#new-password").fill("Synthetic-replaced-password-2026");
  await reset
    .locator("#confirm-password")
    .fill("Synthetic-replaced-password-2026");
  await reset.locator("#reset-submit").click();
  await expect(reset.locator("#message")).toContainText(
    "Contraseña actualizada"
  );
  const stale = await page.goto(h.baseURL + "/admin/productos/1", {
    waitUntil: "networkidle",
  });
  expect(stale?.status() !== 200 || page.url().includes("/admin/login")).toBe(
    true
  );
  const replay = await recovery.request.post(h.baseURL + "/admin/restablecer", {
    headers: { origin: h.baseURL },
    form: {
      token,
      password: "Synthetic-replaced-password-2026",
      confirm: "Synthetic-replaced-password-2026",
    },
  });
  expect(replay.status()).toBe(400);
  await login(reset, "owner", "Synthetic-replaced-password-2026");
  await request("staff@fixture.invalid");
  await expect.poll(() => h.mail.length).toBe(2);
  const expired = h.mail.at(-1).text.match(/#token=([a-f0-9]+)/)[1];
  await h.db.exec("UPDATE workers_admin_password_resets SET expires_at=1");
  const expiry = await recovery.request.post(h.baseURL + "/admin/restablecer", {
    headers: { origin: h.baseURL },
    form: {
      token: expired,
      password: "Synthetic-new-password-2026",
      confirm: "Synthetic-new-password-2026",
    },
  });
  expect(expiry.status()).toBe(400);
  h.failMail(true);
  const attempts = h.mailAttempts;
  await request("vendedor@fixture.invalid");
  await expect.poll(() => h.mailAttempts).toBe(attempts + 1);
  await expect
    .poll(() =>
      count(
        "SELECT COUNT(*) n FROM workers_admin_password_resets WHERE user_id=3"
      )
    )
    .toBe(0);
  h.failMail(false);
  await recovery.close();
});

test("lost import acknowledgement reload resumes committed receipt without duplicate events", async ({
  page,
}) => {
  await login(page);
  await page.goto(h.baseURL + "/admin/productos", { waitUntil: "networkidle" });
  const csv =
    "Producto,Categoría,SKU,Variante,Precio,Stock,Modo de venta,Mostrar precio\n" +
    Array.from(
      { length: 6 },
      (_, i) =>
        `Resume fixture ${i},Synthetic,RESUME-${i},Única,60000,2,enquiry,sí`
    ).join("\n");
  const file = {
    name: "resume.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  };
  async function review(input = file) {
    await page.locator("input[type=file]").setInputFiles(input);
    await page.getByRole("button", { name: /revisar/i }).click();
    await expect(
      page.getByRole("button", { name: /confirmar e importar/i })
    ).toBeVisible();
  }
  await review();
  let lost = false;
  await page.route("**/admin/productos", async (route) => {
    const r = route.request();
    if (
      !lost &&
      r.method() === "POST" &&
      r.headers()["next-action"] &&
      r.postDataBuffer()?.includes(Buffer.from("importId"))
    ) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: /confirmar e importar/i }).click();
  await expect
    .poll(() =>
      count("SELECT COUNT(*) n FROM variants WHERE sku LIKE 'RESUME-%'")
    )
    .toBe(5);
  const pending = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("catalog-import-v1"))
  );
  expect(Boolean(pending?.id)).toBe(true);
  expect(Object.keys(pending).sort()).toEqual(["fingerprint", "id"]);
  await page.unroute("**/admin/productos");
  await page.reload({ waitUntil: "networkidle" });
  await review({
    ...file,
    buffer: Buffer.from(
      csv +
        "\nChanged fixture,Synthetic,RESUME-CHANGED,Única,60000,2,enquiry,sí"
    ),
  });
  await page.getByRole("button", { name: /confirmar e importar/i }).click();
  await expect(page.getByText(/Hay otra importaci.*pendiente/)).toBeVisible();
  expect(
    await count("SELECT COUNT(*) n FROM variants WHERE sku LIKE 'RESUME-%'")
  ).toBe(5);
  await review();
  await page.getByRole("button", { name: /confirmar e importar/i }).click();
  await expect
    .poll(() =>
      count("SELECT COUNT(*) n FROM variants WHERE sku LIKE 'RESUME-%'")
    )
    .toBe(6);
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("catalog-import-v1"))
    )
    .toBe(null);
  expect(await count("SELECT COUNT(*) n FROM catalog_import_receipts")).toBe(2);
  const auditCount = await h.db
    .prepare(
      "SELECT COUNT(*) n FROM catalog_audit WHERE operation='import' AND id LIKE ?"
    )
    .bind(pending.id + ":%")
    .first();
  expect(auditCount.n).toBe(6);
  // This resumed run has exactly two committed batch receipts.
  expect(
    await h.db
      .prepare(
        "SELECT COUNT(*) n FROM catalog_import_receipts WHERE import_id=?"
      )
      .bind(pending.id)
      .first()
      .then((r) => r.n)
  ).toBe(2);
});

test("restored private synthetic owner fixture authenticates through built Worker HTTP", async ({
  page,
  context,
}) => {
  await h.close();
  const sessionSecret = randomBytes(48).toString("hex");
  h = await createHarness({ sessionSecret });
  const target = await createHarness({ sessionSecret });
  try {
    await h.db.exec("UPDATE users SET session_version=7 WHERE id=1");
    const value = randomBytes(24).toString("hex"),
      secretContext = "integraciones/whatsapp/token",
      encrypted = cifrarSecreto(value, secretContext, {
        SESSION_SECRET: sessionSecret,
      });
    await h.db
      .prepare(
        "INSERT INTO integration_settings(integration,data,secrets) VALUES(?,?,?)"
      )
      .bind(
        "whatsapp",
        JSON.stringify({ enabled: false }),
        JSON.stringify({ token: encrypted })
      )
      .run();
    const owner = await h.db
      .prepare(
        "SELECT password_hash,role,session_version FROM users WHERE id=1"
      )
      .first();
    const settings = await h.db
      .prepare(
        "SELECT integration,data,secrets FROM integration_settings WHERE integration=?"
      )
      .bind("whatsapp")
      .first();
    await target.db
      .prepare(
        "UPDATE users SET password_hash=?,role=?,session_version=? WHERE id=1"
      )
      .bind(owner.password_hash, owner.role, owner.session_version)
      .run();
    await target.db
      .prepare(
        "INSERT INTO integration_settings(integration,data,secrets) VALUES(?,?,?)"
      )
      .bind(settings.integration, settings.data, settings.secrets)
      .run();
    const restored = await target.db
      .prepare("SELECT secrets FROM integration_settings WHERE integration=?")
      .bind("whatsapp")
      .first();
    expect(
      descifrarSecreto(JSON.parse(restored.secrets).token, secretContext, {
        SESSION_SECRET: sessionSecret,
      }) === value
    ).toBe(true);
    await restrictBrowser(context, target.baseURL);
    await login(page, "owner", fixturePassword, target.baseURL);
    await page.goto(target.baseURL + "/admin/productos/1", {
      waitUntil: "networkidle",
    });
    await expect(page.getByTestId("admin-product-name-input")).toHaveValue(
      "Synthetic visible"
    );
    expect(
      await target.db
        .prepare("SELECT role,session_version FROM users WHERE id=1")
        .first()
    ).toEqual({ role: "owner", session_version: 7 });
  } finally {
    await target.close();
  }
});
