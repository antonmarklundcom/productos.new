/**
 * Los pasos del embudo para GA4 y el pixel de Meta: ver un producto, sumarlo
 * al carrito, empezar el checkout. La compra ya la manda `purchase-event.tsx`.
 *
 * Sin estos tres, Meta sólo ve visitas y compras: no puede optimizar una
 * campaña de Instagram hacia "gente que agrega al carrito", ni armar un
 * público de "vio este producto y no compró", ni los anuncios de catálogo
 * saben qué producto mostrarle a quién. El id de cada ítem es el **SKU**, el
 * mismo `g:id` del feed (`src/lib/product-feed.ts`): así el evento y el
 * catálogo hablan del mismo producto.
 *
 * No carga nada: si la tienda no configuró GA4 ni el pixel (`analytics.ts`),
 * `gtag`/`fbq` no existen y esto no hace nada.
 */

export type FunnelEvent = "view_item" | "add_to_cart" | "add_to_wishlist" | "begin_checkout";

export type FunnelItem = { id: string; name: string; pricePyg: number; qty: number };

const META_EVENT: Record<FunnelEvent, string> = {
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  add_to_wishlist: "AddToWishlist",
  begin_checkout: "InitiateCheckout",
};

type Medidores = {
  gtag?: (...args: unknown[]) => void;
  fbq?: (...args: unknown[]) => void;
};

/** Lo que recibe cada medidor. Puro, para poder testearlo sin navegador. */
export function funnelPayloads(items: FunnelItem[]) {
  const value = items.reduce((sum, item) => sum + item.pricePyg * item.qty, 0);
  return {
    ga4: {
      currency: "PYG",
      value,
      items: items.map((item) => ({
        item_id: item.id,
        item_name: item.name,
        price: item.pricePyg,
        quantity: item.qty,
      })),
    },
    meta: {
      currency: "PYG",
      value,
      content_type: "product",
      content_ids: items.map((item) => item.id),
      contents: items.map((item) => ({ id: item.id, quantity: item.qty })),
      num_items: items.reduce((sum, item) => sum + item.qty, 0),
    },
  };
}

/** Manda el evento a lo que esté cargado. `true` si alguno lo recibió. */
export function sendFunnelEvent(event: FunnelEvent, items: FunnelItem[], w: Medidores = medidores()): boolean {
  if (items.length === 0) return false;
  const { ga4, meta } = funnelPayloads(items);
  let enviado = false;
  if (typeof w.gtag === "function") {
    w.gtag("event", event, ga4);
    enviado = true;
  }
  if (typeof w.fbq === "function") {
    w.fbq("track", META_EVENT[event], meta);
    enviado = true;
  }
  return enviado;
}

/**
 * Igual que `sendFunnelEvent`, pero para el momento en que la página recién
 * carga: los scripts de medición entran `afterInteractive` y pueden no estar
 * todavía. Reintenta cada 500 ms hasta ~10 s, como `purchase-event.tsx`.
 * Devuelve la función que cancela los reintentos (para el cleanup del efecto).
 */
export function sendFunnelEventWhenReady(event: FunnelEvent, items: FunnelItem[]): () => void {
  if (sendFunnelEvent(event, items)) return () => {};
  let intentos = 0;
  const timer = window.setInterval(() => {
    intentos += 1;
    if (sendFunnelEvent(event, items) || intentos >= 20) window.clearInterval(timer);
  }, 500);
  return () => window.clearInterval(timer);
}

function medidores(): Medidores {
  return typeof window === "undefined" ? {} : (window as unknown as Medidores);
}
