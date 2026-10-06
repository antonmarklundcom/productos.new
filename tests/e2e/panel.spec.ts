import { expect, test } from "@playwright/test";

import {
  COMPRADOR,
  confirmarPedido,
  loginAsOwner,
  openOrderFicha,
  orderTransitionButton,
  realizarCompra,
} from "./helpers";
import { TESTIDS } from "./testids";

/**
 * La puerta de `/admin` y el flujo de quien despacha (fable/plan.md §6.1,
 * spec 2).
 *
 * Hace su propia compra en vez de depender de `compra.spec.ts`: con
 * `fullyParallel` el orden entre specs no está garantizado (§6.1 lo dice
 * explícito — "preferir independencia").
 */
test("la puerta de /admin redirige, el login entra y el pedido aparece en el panel", async ({
  page,
}) => {
  const { orderNumber } = await realizarCompra(page);

  await loginAsOwner(page);

  // Filtra por el número de pedido: la lista sin filtro pagina y el pedido
  // recién creado puede no estar en la primera página.
  await page.getByTestId(TESTIDS.adminOrdersSearchInput).fill(orderNumber);
  await page.getByTestId(TESTIDS.adminOrdersSearchSubmit).click();

  await expect(page.getByText(orderNumber)).toBeVisible();
});

/**
 * Despachar con guía de seguimiento (S9, plan-operacion §6.1): el paso
 * intermedio de "Enviado" acepta courier/guía/link, la ficha del pedido los
 * muestra en el bloque "Seguimiento" y la compradora los ve en su propia
 * página del pedido — el mismo dato, en los dos lados del mostrador.
 */
test("despachar con guía: la ficha y la página de la compradora la muestran", async ({ page }) => {
  const { orderNumber, url } = await realizarCompra(page);

  await loginAsOwner(page);
  await openOrderFicha(page, orderNumber);

  // pendiente_pago → pagado → preparando → enviado (con guía). Las dos
  // primeras no paran en el paso intermedio (no son destructivas ni
  // `enviado`): confirman solas.
  await orderTransitionButton(page, "pagado").click();
  await expect(orderTransitionButton(page, "preparando")).toBeVisible();

  await orderTransitionButton(page, "preparando").click();
  await expect(orderTransitionButton(page, "enviado")).toBeVisible();

  await orderTransitionButton(page, "enviado").click();

  const trackingCode = `E2E-${Date.now()}`;
  await page.getByTestId(TESTIDS.orderTrackingCarrierInput).fill("Moto propia");
  await page.getByTestId(TESTIDS.orderTrackingCodeInput).fill(trackingCode);
  await page.getByTestId(TESTIDS.orderTransitionConfirm).click();

  await expect(page.getByTestId(TESTIDS.orderTrackingBlock)).toContainText(trackingCode);

  // La compradora entra con su propio link tokenizado, no con la sesión del
  // panel: navegar a `url` (la que devuelve `realizarCompra`) alcanza.
  await page.goto(url);
  await expect(page.getByTestId(TESTIDS.pedidoTrackingBlock)).toContainText(trackingCode);
});

/**
 * Notas internas (S9, plan-operacion §6.1): se agregan desde la ficha y
 * aparecen en la lista sin recargar la página a mano (`router.refresh()`).
 * Nunca las ve la compradora — eso lo garantiza el dominio, acá sólo se
 * prueba que el mostrador las vea.
 */
test("agregar una nota interna: aparece en la lista de la ficha", async ({ page }) => {
  const { orderNumber } = await realizarCompra(page);

  await loginAsOwner(page);
  await openOrderFicha(page, orderNumber);

  const noteText = `Llamó, pasa el jueves — E2E ${Date.now()}`;
  await page.getByTestId(TESTIDS.orderNotesTextarea).fill(noteText);
  await page.getByTestId(TESTIDS.orderNotesSubmit).click();

  await expect(page.getByTestId(TESTIDS.orderNotesList)).toContainText(noteText);
});

/**
 * Editar un pedido antes del pago (O16 dejó el dominio; S17 la piel) —
 * fable/plan-crecimiento.md §6.1 D/G: bajar una cantidad y ver el total nuevo
 * en la ficha del panel **y** en la página de la compradora — siempre el que
 * devuelve `editPendingOrderAction`, nunca uno calculado en el navegador.
 *
 * Arma un pedido con 2 unidades de la misma variante (agregar dos veces, con
 * un Escape en el medio para cerrar el carrito y poder tocar el botón de
 * nuevo): con una sola unidad, bajar a 0 dejaría el pedido sin líneas, que el
 * dominio rechaza (no es lo que este spec quiere probar).
 */
test("editar un pedido: bajar una cantidad cambia el total en la ficha y en /pedido/...", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId(TESTIDS.headerCategoryLink).first().click();
  await expect(page).toHaveURL(/\/categoria\//);

  await page.getByTestId(TESTIDS.productCard).first().click();
  await expect(page).toHaveURL(/\/producto\//);

  await page.getByTestId(TESTIDS.productAddToCart).click();
  await expect(page.getByTestId(TESTIDS.cartCheckoutLink)).toBeVisible();
  await page.keyboard.press("Escape");
  // Esperar a que el sheet termine de cerrar: reabrirlo mientras todavía
  // está animando la salida deja al `Sheet` (Radix) en un estado que no
  // vuelve a abrir con el segundo click.
  await expect(page.getByTestId(TESTIDS.cartCheckoutLink)).toBeHidden();
  await page.getByTestId(TESTIDS.productAddToCart).click();

  await expect(page.getByTestId(TESTIDS.cartCheckoutLink)).toBeVisible();
  await page.getByTestId(TESTIDS.cartCheckoutLink).click();
  await expect(page).toHaveURL(/\/checkout/);

  await page.getByTestId(TESTIDS.checkoutName).fill(COMPRADOR.name);
  await page.getByTestId(TESTIDS.checkoutPhone).fill(COMPRADOR.phone);
  await page.getByTestId(TESTIDS.checkoutDocType).selectOption("CI");
  await page.getByTestId(TESTIDS.checkoutDocNumber).fill(COMPRADOR.docNumber);
  await page.getByTestId(TESTIDS.checkoutCity).fill(COMPRADOR.city);
  await page.getByTestId(TESTIDS.checkoutAddress).fill(COMPRADOR.address);
  await expect(page.getByTestId(TESTIDS.checkoutTotal)).toBeVisible({ timeout: 5000 });

  const { orderNumber, url } = await confirmarPedido(page);

  await loginAsOwner(page);
  await openOrderFicha(page, orderNumber);

  const totalAntes = await page.getByTestId(TESTIDS.adminOrderTotal).innerText();

  await page.getByTestId(TESTIDS.adminEditOrderOpen).click();
  await page.getByTestId(TESTIDS.adminEditOrderQty).fill("1");
  await page.getByTestId(TESTIDS.adminEditOrderReason).fill(`Bajó a 1 unidad — E2E ${Date.now()}`);
  await page.getByTestId(TESTIDS.adminEditOrderSubmit).click();

  await expect(page.getByTestId(TESTIDS.adminEditOrderResult)).toBeVisible();

  // `router.refresh()` (dentro de `EditOrderForm`) es asíncrono: el resumen
  // "total antes → después" ya está en pantalla antes de que el Server
  // Component de la ficha vuelva a pedir `order.totalPyg`. Un `innerText()`
  // suelto lee lo que hubiera antes de esa segunda vuelta; `toHaveText`
  // reintenta hasta que el DOM cambie de verdad.
  await expect(page.getByTestId(TESTIDS.adminOrderTotal)).not.toHaveText(totalAntes);
  const totalDespues = await page.getByTestId(TESTIDS.adminOrderTotal).innerText();

  // La compradora entra con su propio link tokenizado — el total que ve tiene
  // que ser el mismo que quedó en el panel, no una segunda cuenta.
  await page.goto(url);
  await expect(page.getByTestId(TESTIDS.pedidoTotal)).toHaveText(totalDespues);
});
