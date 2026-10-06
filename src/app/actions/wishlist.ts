"use server";

import { z } from "zod";

import { getProductsBySlugs, type CatalogProduct } from "@/db/queries";

/**
 * Resuelve `/favoritos`: la lista de slugs vive en el navegador
 * (`src/lib/wishlist-store.ts`), pero lo que se muestra —precio,
 * disponibilidad, si sigue publicado— siempre sale de la DB, nunca del
 * snapshot que guardó el localStorage.
 *
 * El slug es el único dato que cruza la red: nada de nombre ni precio, que
 * es justo lo que el store del navegador no guarda.
 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const InputSchema = z.array(z.string().max(160).regex(SLUG_RE)).max(50);

export async function getWishlistProducts(slugs: string[]): Promise<CatalogProduct[]> {
  const parsed = InputSchema.safeParse(slugs);
  if (!parsed.success) return [];
  return getProductsBySlugs(parsed.data);
}
