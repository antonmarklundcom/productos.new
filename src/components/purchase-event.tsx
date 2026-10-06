"use client";

import { useEffect } from "react";

/**
 * El evento `purchase`/`Purchase` en la página del pedido.
 *
 * Es el dato que convierte los medidores en algo útil: sin él, GA4 y el pixel
 * saben cuánta gente entró pero no cuánta compró — y "qué campaña vende" es
 * la única pregunta que al comercio le importa.
 *
 * Dos trampas resueltas acá:
 *
 * - **La página del pedido se abre muchas veces** (es el link que el
 *   comprador guarda y el que va por WhatsApp). El evento tiene que salir una
 *   vez por navegador, no una por visita: `localStorage` con el número de
 *   pedido como llave, y en try/catch porque en modo incógnito puede tirar.
 *   GA4 además deduplica por `transaction_id` y el pixel por `eventID` — tres
 *   redes, porque contar una venta dos veces infla el ROAS y hace tomar
 *   decisiones de plata con un número falso.
 * - **Los scripts de medición cargan después de la hidratación**
 *   (`afterInteractive`), así que `gtag`/`fbq` pueden no existir todavía
 *   cuando corre el efecto. Se reintenta con un timer corto y se rinde a los
 *   ~10 s: un evento perdido por red lenta se recupera en la próxima visita,
 *   porque la llave sólo se escribe cuando de verdad se mandó.
 *
 * El monto va en guaraníes enteros con `currency: "PYG"`, que es exactamente
 * lo que son.
 */
export function PurchaseEvent({
  orderNumber,
  totalPyg,
  items = [],
}: {
  orderNumber: string;
  totalPyg: number;
  /**
   * Las líneas del pedido, con el SKU como id — el mismo `g:id` del feed
   * (`src/lib/product-feed.ts`): así Meta y Google atribuyen la venta al
   * producto del catálogo, que es lo que optimizan los anuncios de catálogo.
   */
  items?: { sku: string; name: string; unitPricePyg: number; qty: number }[];
}) {
  useEffect(() => {
    const key = `compra-medida-${orderNumber}`;
    try {
      if (window.localStorage.getItem(key)) return;
    } catch {
      // Sin storage no hay forma de deduplicar entre visitas: mejor no mandar
      // que mandar en cada apertura del link.
      return;
    }

    let intentos = 0;
    const timer = window.setInterval(() => {
      intentos += 1;
      const w = window as unknown as {
        gtag?: (...args: unknown[]) => void;
        fbq?: (...args: unknown[]) => void;
      };
      const listo = typeof w.gtag === "function" || typeof w.fbq === "function";

      if (!listo) {
        if (intentos >= 20) window.clearInterval(timer);
        return;
      }
      window.clearInterval(timer);

      if (typeof w.gtag === "function") {
        w.gtag("event", "purchase", {
          transaction_id: orderNumber,
          value: totalPyg,
          currency: "PYG",
          items: items.map((item) => ({
            item_id: item.sku,
            item_name: item.name,
            price: item.unitPricePyg,
            quantity: item.qty,
          })),
        });
      }
      if (typeof w.fbq === "function") {
        w.fbq(
          "track",
          "Purchase",
          {
            value: totalPyg,
            currency: "PYG",
            content_type: "product",
            content_ids: items.map((item) => item.sku),
            contents: items.map((item) => ({ id: item.sku, quantity: item.qty })),
            num_items: items.reduce((sum, item) => sum + item.qty, 0),
          },
          { eventID: orderNumber },
        );
      }
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        // Ya se mandó; sin storage, la próxima visita puede repetirlo y ahí
        // deduplican transaction_id/eventID.
      }
    }, 500);

    return () => window.clearInterval(timer);
    // `items` llega del servidor y no cambia; con él en la lista, cada render
    // (un array nuevo) reiniciaría los reintentos. La llave de localStorage es
    // el número de pedido, que sí está.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber, totalPyg]);

  return null;
}
