import { asc, eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";

import "../../src/lib/load-env";
import { closePool, getDb } from "../../src/db";
import { categories, products } from "../../src/db/schema";

import { TESTIDS } from "./testids";

/**
 * El CSP de verdad, en un navegador de verdad (fable/plan.md §6.1, spec 3).
 *
 * Recorre las rutas cacheadas (home, categoría — sin nonce, `'unsafe-inline'`
 * de `src/proxy.ts`) y las que se renderizan por request (producto, checkout,
 * admin/login — con nonce y `'strict-dynamic'`) y no tiene que aparecer
 * **ningún** mensaje de violación en la consola, con una sola excepción
 * documentada.
 *
 * La excepción (comentario largo en `src/proxy.ts`, sección
 * `withSecurityHeaders`): en las rutas con nonce, Next 16.3 emite el chunk de
 * `next/image` sin el atributo `nonce`, y el navegador lo bloquea — una
 * violación por pantalla, siempre un chunk suelto de `_next/static/chunks/`.
 * Las fotos igual cargan porque el `<img>` sale renderizado del servidor.
 * Cualquier otra violación —dos en la misma pantalla, o en home/categoría
 * donde no debería haber ninguna— es un bug real.
 *
 * El texto exacto del mensaje **no** es estable entre versiones de Chromium
 * — local (`Refused to load the script '…' because it violates…`) contra CI
 * (`Loading the script '…' violates… The action has been blocked.`), mismo
 * chunk, mismo bug, dos redacciones distintas. El patrón agarra la parte que
 * sí es estable: un script bloqueado por CSP cuya URL es un chunk suelto de
 * `_next/static/chunks/`.
 */
const CHUNK_SIN_NONCE =
  /_next\/static\/chunks\/[^'"\s]+\.js[^]*content security policy/i;

function violacionesReales(mensajes: string[]): string[] {
  return mensajes.filter(
    (mensaje) =>
      /content security policy/i.test(mensaje) && !CHUNK_SIN_NONCE.test(mensaje)
  );
}

async function collectConsole(page: Page): Promise<string[]> {
  const mensajes: string[] = [];
  page.on("console", (msg) => mensajes.push(msg.text()));
  page.on("pageerror", (error) => mensajes.push(error.message));
  return mensajes;
}

/**
 * Una categoría y un producto de verdad, resueltos contra la base en vez de
 * hardcodeados: este spec no puede conocer el catálogo de la tienda (una
 * categoría real reemplaza a las cuatro del seed en cuanto el comercio carga
 * la suya). Sólo hace falta que exista **alguno** de cada uno.
 */
let categoriaSlug = "";
let productoSlug = "";
let productoNombre = "";

test.beforeAll(async () => {
  const db = getDb();
  const [categoria] = await db
    .select()
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.position))
    .limit(1);
  const [producto] = await db
    .select()
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(asc(products.id))
    .limit(1);

  if (!categoria || !producto) {
    throw new Error(
      "csp.spec.ts necesita al menos una categoría y un producto activos — ¿corriste `pnpm db:seed`?"
    );
  }

  categoriaSlug = categoria.slug;
  productoSlug = producto.slug;
  productoNombre = producto.name;
});

test.afterAll(async () => {
  await closePool();
});

test("home y categoría (cacheadas): CSP sin ninguna violación", async ({
  page,
}) => {
  const mensajes = await collectConsole(page);

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.goto(`/categoria/${categoriaSlug}`);
  await page.waitForLoadState("networkidle");

  expect(violacionesReales(mensajes), mensajes.join("\n")).toEqual([]);
});

test("producto y admin/login (con nonce): sólo la violación documentada del chunk de next/image", async ({
  page,
}) => {
  const mensajes = await collectConsole(page);

  await page.goto(`/producto/${productoSlug}`);
  await page.waitForLoadState("networkidle");
  await page.goto("/admin/login");
  await page.waitForLoadState("networkidle");

  expect(violacionesReales(mensajes), mensajes.join("\n")).toEqual([]);
});

test("checkout con carrito (con nonce): sólo la violación documentada del chunk de next/image", async ({
  page,
}) => {
  await page.goto(`/producto/${productoSlug}`);
  await page.getByTestId(TESTIDS.productAddToCart).click();

  const mensajes = await collectConsole(page);
  await page.goto("/checkout");
  await page.waitForLoadState("networkidle");

  expect(violacionesReales(mensajes), mensajes.join("\n")).toEqual([]);
  await expect(page.getByTestId(TESTIDS.checkoutName)).toBeVisible();
});

test("el buscador del header responde (hay JS vivo en la home)", async ({
  page,
}) => {
  await page.goto("/");
  // Dos `<SearchBox>` conviven en el DOM (uno para `sm:` y arriba, otro para
  // el celular, abajo): sólo uno es visible en el viewport de Chromium.
  const buscador = page.getByLabel("Buscar productos").first();
  await buscador.fill(productoNombre);

  await expect(
    page.getByRole("listbox", { name: "Sugerencias" })
  ).toBeVisible();
  await expect(page.getByRole("option").first()).toBeVisible();
});
