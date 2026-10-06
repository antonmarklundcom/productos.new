import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { TESTIDS } from "./testids";

/**
 * El radio de una forma de entrega, ubicado por `data-slug` y no por el
 * nombre que se ve en pantalla (`checkout-form.tsx`): el nombre es el que
 * cargó el comercio, y dos formas de entrega bien pueden compartir texto
 * parcial ("Moto" y "Moto express").
 */
export function shippingMethodRadio(page: Page, slug: string): Locator {
  return page.locator(
    `[data-testid="${TESTIDS.checkoutShippingMethod}"][data-slug="${slug}"]`
  );
}

/**
 * El radio de un medio de pago, ubicado por `data-value` — el enum del
 * dominio (`transferencia` | `contra_entrega` | `tarjeta`), nunca por la
 * etiqueta traducida.
 */
export function paymentMethodRadio(page: Page, value: string): Locator {
  return page.locator(
    `[data-testid="${TESTIDS.checkoutPaymentMethod}"][data-value="${value}"]`
  );
}

/**
 * La fila de un pedido en `/admin/pedidos`, ubicada por `data-order` (el
 * número de pedido) y no por el texto visible — mismo criterio que
 * `shippingMethodRadio` (S9, plan-operacion §6.1).
 */
export function adminOrderRow(page: Page, orderNumber: string): Locator {
  return page.locator(
    `[data-testid="${TESTIDS.adminOrderRowLink}"][data-order="${orderNumber}"]`
  );
}

/**
 * El botón que dispara una transición de estado en la ficha del pedido
 * (`order-actions.tsx`), ubicado por `data-status` — el enum del dominio, no
 * la etiqueta traducida (S9, plan-operacion §6.1).
 */
export function orderTransitionButton(page: Page, status: string): Locator {
  return page.locator(
    `[data-testid="${TESTIDS.orderTransitionButton}"][data-status="${status}"]`
  );
}

/**
 * Entra a `/admin` con `OWNER_EMAIL`/`OWNER_PASSWORD` (sembrados por
 * `pnpm create-owner` o `POST /api/setup/init`) y espera el nav del panel.
 * Repetido en cada spec de `panel.spec.ts` que necesita sesión — factorizado
 * acá para no desincronizar los tres al primer cambio de la puerta.
 */
export async function loginAsOwner(page: Page): Promise<void> {
  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;
  if (!ownerEmail || !ownerPassword) {
    throw new Error(
      "Faltan OWNER_EMAIL/OWNER_PASSWORD en el entorno del test — son los mismos que usó " +
        "`pnpm create-owner` (o `POST /api/setup/init`) para sembrar la cuenta del dueño."
    );
  }

  await page.goto("/admin/pedidos");
  await page.waitForURL(/\/admin\/login\?next=%2Fadmin%2Fpedidos/);
  await page.getByTestId(TESTIDS.adminLoginEmail).fill(ownerEmail);
  await page.getByTestId(TESTIDS.adminLoginPassword).fill(ownerPassword);
  await page.getByTestId(TESTIDS.adminLoginSubmit).click();
  await page.waitForURL(/\/admin\/pedidos$/);
  await expect(page.getByTestId(TESTIDS.adminNavOrders)).toBeVisible();
}

/**
 * Busca un pedido por número en `/admin/pedidos` y entra a su ficha.
 */
export async function openOrderFicha(page: Page, orderNumber: string): Promise<void> {
  await page.getByTestId(TESTIDS.adminOrdersSearchInput).fill(orderNumber);
  await page.getByTestId(TESTIDS.adminOrdersSearchSubmit).click();
  await adminOrderRow(page, orderNumber).click();
  await page.waitForURL(/\/admin\/pedidos\/\d+$/);
}

/**
 * Datos de una compra válida, iguales a los que pide el plan (fable/plan.md
 * §6.1): teléfono `+5959…`, documento CI, ciudad de una zona sembrada
 * (`scripts/seed-data.ts`) y transferencia — el único medio de pago que esta
 * tienda ofrece sin credenciales de Pagopar.
 *
 * La ciudad **sí** sigue hardcodeada: no es catálogo, es una zona de envío, y
 * cualquier tienda clonada necesita al menos una para vender. Lo que este
 * archivo ya no asume es la categoría o el producto — esos salen de lo que la
 * tienda tenga cargado en el momento del test.
 */
export const COMPRADOR = {
  name: "Compradora E2E",
  phone: "+595981234567",
  docNumber: "1234567",
  city: "Asunción",
  address: "Mcal. López 1234",
} as const;

/**
 * Home → una categoría → un producto → agregarlo al carrito → checkout →
 * confirmar. Se usa tal cual en `compra.spec.ts` y, para no depender del
 * orden de ejecución de los specs, también en `panel.spec.ts` (fable/plan.md
 * §6.1: "preferir independencia").
 *
 * Devuelve el número de pedido y la URL de la página de seguimiento, tal como
 * quedan después del `router.push`.
 */
export async function realizarCompra(
  page: Page
): Promise<{ orderNumber: string; url: string }> {
  await completarCheckout(page);
  return confirmarPedido(page);
}

/**
 * Home → categoría → producto → carrito → checkout, con los datos de la
 * compradora ya cargados y el total en pantalla. Separado de `realizarCompra`
 * porque hay specs que necesitan tocar algo **antes** de confirmar —elegir una
 * forma de entrega, por ejemplo— y repetir estos veinte pasos en cada uno los
 * deja desincronizados a la primera que alguien renombre un campo.
 *
 * Ubica todo por `data-testid` (ver `src/lib/testids.ts`) y nunca por texto o
 * slug del seed: la primera categoría y el primer producto que existan, sean
 * los que sean. Un spec que conociera el catálogo de la tienda se rompería en
 * cada tienda clonada — que es exactamente el bug que este contrato existe
 * para no repetir (NEW-STORE.md §5).
 */
export async function completarCheckout(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId(TESTIDS.headerCategoryLink).first().click();
  await expect(page).toHaveURL(/\/categoria\//);

  await page.getByTestId(TESTIDS.productCard).first().click();
  await expect(page).toHaveURL(/\/producto\//);

  // Agregar abre el carrito solo (`cart-store.ts`: `add()` deja `isOpen:
  // true`) — no hace falta un click aparte en `header-cart-link` para verlo.
  await page.getByTestId(TESTIDS.productAddToCart).click();

  await page.getByTestId(TESTIDS.cartCheckoutLink).click();
  await expect(page).toHaveURL(/\/checkout/);

  await page.getByTestId(TESTIDS.checkoutName).fill(COMPRADOR.name);
  await page.getByTestId(TESTIDS.checkoutPhone).fill(COMPRADOR.phone);

  await page.getByTestId(TESTIDS.checkoutDocType).selectOption("CI");
  await page.getByTestId(TESTIDS.checkoutDocNumber).fill(COMPRADOR.docNumber);

  await page.getByTestId(TESTIDS.checkoutCity).fill(COMPRADOR.city);
  await page.getByTestId(TESTIDS.checkoutAddress).fill(COMPRADOR.address);

  // La cotización de envío se dispara con un debounce (400ms); esperar la
  // línea de total deja el número visible en pantalla antes de confirmar,
  // igual que haría una persona.
  await expect(page.getByTestId(TESTIDS.checkoutTotal)).toBeVisible({
    timeout: 5000,
  });
}

/**
 * Apretar "Confirmar pedido" y esperar la página del pedido. Devuelve el
 * número y la URL tal como quedan después del `router.push`.
 */
export async function confirmarPedido(
  page: Page
): Promise<{ orderNumber: string; url: string }> {
  await page.getByTestId(TESTIDS.checkoutSubmit).click();

  await page.waitForURL(/\/pedido\/PY-[^/?]+\?t=/, { timeout: 15_000 });

  const url = page.url();
  const orderNumber = new URL(url).pathname.split("/").pop() ?? "";
  return { orderNumber, url };
}
