"use client";

import { useEffect, useRef } from "react";

import { useCart } from "@/lib/cart-store";
import { sendFunnelEventWhenReady, type FunnelEvent as Evento, type FunnelItem } from "@/lib/funnel";

/**
 * Un paso del embudo al abrir la página (`src/lib/funnel.ts`). Sólo se
 * renderiza con algún medidor configurado — quien la usa lo decide con
 * `analyticsActivo()`, igual que `PurchaseEvent`.
 */
export function FunnelEvent({ event, items }: { event: Evento; items: FunnelItem[] }) {
  const enviado = useRef(false);
  useEffect(() => {
    if (enviado.current) return;
    enviado.current = true;
    // Sin cleanup a propósito: los reintentos se cortan solos (~10 s), y
    // cancelarlos en el doble montaje de desarrollo perdería el evento.
    sendFunnelEventWhenReady(event, items);
    // Una vez por página: los ítems no cambian después del render del servidor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * "Empezó el checkout", con lo que hay en el carrito. El carrito vive en el
 * navegador y se hidrata después del primer render: se espera a que tenga
 * líneas y se manda una sola vez.
 */
export function BeginCheckoutEvent() {
  const lines = useCart((state) => state.lines);
  const enviado = useRef(false);
  useEffect(() => {
    if (enviado.current || lines.length === 0) return;
    enviado.current = true;
    sendFunnelEventWhenReady(
      "begin_checkout",
      lines.map((line) => ({
        id: line.sku ?? String(line.variantId),
        name: line.name,
        pricePyg: line.unitPricePyg,
        qty: line.qty,
      })),
    );
  }, [lines]);
  return null;
}
