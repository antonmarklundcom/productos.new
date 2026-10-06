"use server";

import { z } from "zod";

import { priceCart, type PricedCart } from "@/domain/cart";
import { freeShippingWithoutZone, type FreeShippingProgress } from "@/domain/free-shipping";
import { listShippingZones } from "@/domain/shipping";

/**
 * Server action que revalida el carrito. La llama el slide-over al abrirse y
 * el checkout al entrar: es el único momento en que los precios que ve el
 * comprador vuelven a coincidir con la DB.
 */

const RevalidateInputSchema = z.array(
  z.object({
    variantId: z.number().int().positive(),
    qty: z.number().int().min(1).max(99),
    // Lo que el navegador venía mostrando: sirve para avisar del cambio,
    // nunca para cobrar.
    unitPricePyg: z.number().int().nonnegative().optional(),
  })
);

/**
 * Además del re-precio, el progreso hacia el envío gratis.
 *
 * Va acá y no en una llamada aparte porque es el mismo momento y el mismo
 * carrito: dos viajes al servidor para dibujar una barra sería un viaje de
 * más en una red móvil paraguaya. El carrito todavía no sabe la ciudad, así
 * que el estado que sale de acá suele ser el "indefinido" —el que se dibuja
 * con la aclaración— y recién el checkout, con la ciudad puesta, consigue el
 * número exacto (ver `quoteCartShipping`).
 */
export type RevalidatedCart = PricedCart & { freeShipping: FreeShippingProgress };

const EMPTY: RevalidatedCart = {
  lines: [],
  subtotalPyg: 0,
  iva10Pyg: 0,
  iva5Pyg: 0,
  issues: [],
  freeShipping: { kind: "sin_umbral" },
};

export async function revalidateCart(input: unknown): Promise<RevalidatedCart> {
  const parsed = RevalidateInputSchema.safeParse(input);
  if (!parsed.success) return EMPTY;

  const expectedPrices = new Map<number, number>();
  for (const item of parsed.data) {
    if (item.unitPricePyg !== undefined) expectedPrices.set(item.variantId, item.unitPricePyg);
  }

  const priced = await priceCart(
    parsed.data.map((item) => ({ variantId: item.variantId, qty: item.qty })),
    { expectedPrices }
  );

  // Las zonas no se cachean acá a propósito: son cuatro filas y el dueño las
  // edita el día que cambia el flete.
  const zones = await listShippingZones().catch(() => []);

  return { ...priced, freeShipping: freeShippingWithoutZone(zones, priced.subtotalPyg) };
}
