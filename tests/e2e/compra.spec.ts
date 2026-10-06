import { eq, inArray } from "drizzle-orm";
import { expect, test } from "@playwright/test";

import "../../src/lib/load-env";
import { closePool, getDb } from "../../src/db";
import { categories, orders, products, shippingMethods, shippingZones, variants } from "../../src/db/schema";

import {
  completarCheckout,
  confirmarPedido,
  paymentMethodRadio,
  realizarCompra,
  shippingMethodRadio,
} from "./helpers";
import { TESTIDS } from "./testids";

/**
 * El camino completo de una compradora: home → categoría → producto →
 * carrito → checkout → pantalla del pedido (fable/plan.md §6.1, spec 1).
 *
 * El job de CI no configura `BANCO_*` (no hay credenciales reales que
 * commitear), así que lo esperable es el aviso de "sin datos bancarios" — no
 * un error.
 */
test("compra de invitado con transferencia llega a la página del pedido", async ({
  page,
}) => {
  const { orderNumber, url } = await realizarCompra(page);

  expect(orderNumber).toMatch(/^PY-/);
  await expect(page).toHaveURL(url);

  await expect(page.getByTestId(TESTIDS.orderConfirmationNumber)).toHaveText(orderNumber);
  await expect(page.getByText("Pagá por transferencia o QR")).toBeVisible();

  const datosBancarios = page.getByText("Banco", { exact: true });
  const sinDatos = page.getByText(
    "Los datos bancarios del comercio todavía no están configurados.",
    { exact: false }
  );
  await expect(datosBancarios.or(sinDatos)).toBeVisible();
});

/**
 * Un comprobante de 2 MB —la foto normal de un celular— tiene que llegar a la
 * server action. Con el límite por defecto de Next (1 MB) el body se cortaba
 * antes con un 413 y la compradora veía la pantalla de error: nunca podía
 * pagar por transferencia con una foto.
 *
 * El archivo es basura con nombre `.png` a propósito: el único que puede
 * responder "Subí una foto…" es `validateReceipt`, adentro de la acción. Si el
 * body no pasa, ese texto no aparece.
 */
test("un comprobante de 2 MB llega a la acción (no lo corta el límite de Next)", async ({
  page,
}) => {
  await realizarCompra(page);

  await page.locator('input[name="file"]').setInputFiles({
    name: "comprobante.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(2 * 1024 * 1024, "x"),
  });
  await page.getByRole("button", { name: "Enviar comprobante" }).click();

  await expect(
    page.getByText("Subí una foto (JPG o PNG) o un PDF del comprobante.")
  ).toBeVisible({ timeout: 15_000 });
});

/**
 * Formas de entrega en un navegador de verdad (FASE 3).
 *
 * Lo que se prueba es la promesa entera de la feature en la única pantalla
 * donde se paga: elegir la moto del barrio deja **contra entrega** como el
 * medio de pago posible, y el courier nacional —que no está en la puerta para
 * cobrar— desaparece del formulario. Nada de eso se puede afirmar sin
 * renderizar: el filtrado pasa en el cliente, con la cotización viniendo de una
 * server action.
 *
 * Los dos métodos los crea el spec y se los lleva al terminar: el seed no
 * siembra ninguno **a propósito** (una tienda recién clonada tiene que arrancar
 * con el checkout de siempre), así que la configuración es parte del caso.
 */
const SLUGS_E2E = ["e2e-courier-nacional", "e2e-moto-del-barrio"];

test.describe("con formas de entrega configuradas", () => {
  // En serie y en un solo worker: los dos métodos son estado compartido de la
  // base, no del navegador.
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const db = getDb();
    const zonas = await db.select().from(shippingZones);
    const asuncion = zonas.find((zona) => zona.cities.includes("Asunción"));

    await db.insert(shippingMethods).values([
      {
        slug: SLUGS_E2E[0]!,
        name: "Courier nacional E2E",
        kind: "courier",
        pricing: "zona",
        zoneIds: [],
        // El courier no cobra en la puerta: por eso contra entrega no está.
        allowedPaymentMethods: ["transferencia"],
        description: "Llega en 24-48 h a todo el país.",
        position: 0,
      },
      {
        slug: SLUGS_E2E[1]!,
        name: "Moto del barrio E2E",
        kind: "local",
        pricing: "fijo",
        fixedPricePyg: 15_000,
        zoneIds: asuncion ? [asuncion.id] : [],
        allowedPaymentMethods: ["contra_entrega"],
        description: "Te lo llevamos hoy y pagás al recibirlo.",
        position: 1,
      },
    ]);
  });

  test.afterAll(async () => {
    const db = getDb();
    const creados = await db
      .select({ id: shippingMethods.id })
      .from(shippingMethods)
      .where(inArray(shippingMethods.slug, SLUGS_E2E));

    // Los pedidos del spec sobreviven al método (la FK es ON DELETE SET NULL y
    // el nombre quedó en el snapshot), pero se los desata primero para no
    // depender de eso en un test.
    for (const { id } of creados) {
      await db
        .update(orders)
        .set({ shippingMethodId: null })
        .where(eq(orders.shippingMethodId, id));
    }
    await db.delete(shippingMethods).where(inArray(shippingMethods.slug, SLUGS_E2E));
    await closePool();
  });

  test("elegir la moto local deja contra entrega como medio de pago", async ({ page }) => {
    await completarCheckout(page);

    // Con dos métodos válidos aparece la pregunta; con uno solo no se dibuja.
    await expect(page.getByText("¿Cómo querés recibirlo?")).toBeVisible();

    // El courier viene preseleccionado (es el primero) y sólo ofrece
    // transferencia.
    await expect(paymentMethodRadio(page, "transferencia")).toBeVisible();

    await shippingMethodRadio(page, SLUGS_E2E[1]!).check();

    // Al elegir la moto, transferencia deja de existir y contra entrega queda
    // marcada sola: es el filtrado que da sentido a toda la tabla.
    await expect(paymentMethodRadio(page, "contra_entrega")).toBeChecked();
    await expect(paymentMethodRadio(page, "transferencia")).toHaveCount(0);

    // Y el flete pasa a ser la tarifa plana de la moto, no el de la zona.
    await expect(page.getByText("₲ 15.000").first()).toBeVisible({ timeout: 5000 });

    const { orderNumber } = await confirmarPedido(page);
    expect(orderNumber).toMatch(/^PY-/);

    await expect(page.getByTestId(TESTIDS.orderConfirmationNumber)).toHaveText(orderNumber);
    // Contra entrega no muestra el bloque de transferencia: se paga al recibir.
    await expect(page.getByText("Pagá por transferencia o QR")).toHaveCount(0);
  });
});

/**
 * "Avisame cuando haya stock" (plan-operacion §6.3): el formulario se dibuja
 * **sólo** cuando `stockAlertsEnabled()` es `true` — sender disponible y
 * plantilla de Meta cargada. El job de CI no configura ninguna de las dos
 * cosas, así que el caso que hay que fijar acá es que, delante de una
 * variante sin stock, el formulario **no aparece** — nunca un botón que no
 * puede funcionar.
 */
test.describe("avisame cuando haya stock", () => {
  const SLUG_SIN_STOCK = "e2e-sin-stock-s11";
  let productId = 0;

  test.beforeAll(async () => {
    const db = getDb();
    const [categoria] = await db.select().from(categories).where(eq(categories.isActive, true)).limit(1);
    if (!categoria) {
      throw new Error("Este spec necesita al menos una categoría activa — ¿corriste `pnpm db:seed`?");
    }

    const [inserted] = await db.insert(products).values({
      slug: SLUG_SIN_STOCK,
      name: "Producto E2E sin stock",
      categoryId: categoria.id,
      isActive: true,
      publishedAt: new Date(),
    });
    productId = inserted.insertId;

    await db.insert(variants).values({
      productId,
      sku: `${SLUG_SIN_STOCK}-unica`,
      label: "Única",
      pricePyg: 50_000,
      onHand: 0,
      isActive: true,
    });
  });

  test.afterAll(async () => {
    if (productId) {
      // `ON DELETE CASCADE` en `variants.product_id` se lleva la variante sola.
      await getDb().delete(products).where(eq(products.id, productId));
    }
    await closePool();
  });

  test("producto sin stock no muestra el formulario en CI (sin sender configurado)", async ({
    page,
  }) => {
    await page.goto(`/producto/${SLUG_SIN_STOCK}`);

    await expect(page.getByTestId(TESTIDS.productAddToCart)).toBeDisabled();
    await expect(page.getByTestId(TESTIDS.stockAlertForm)).toHaveCount(0);
  });
});
