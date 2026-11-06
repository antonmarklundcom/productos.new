import { randomUUID } from "node:crypto";

// Native public readers share aliases p (products) and c (categories).
export const hasActiveCatalogVariant = "EXISTS (SELECT 1 FROM variants active_variant WHERE active_variant.product_id = p.id AND active_variant.is_active = 1)";
export const catalogProductHasOffer = "(p.sale_mode = 'showcase' OR " + hasActiveCatalogVariant + ")";
export const publishedCatalogProduct = "p.is_active = 1 AND p.published_at IS NOT NULL AND c.is_active = 1 AND " + catalogProductHasOffer;

export const publicationNeedsVariant = "Agregá o activá una variante antes de publicar este producto.";

export const lastVariantMessage = "No podés desactivar la última variante activa. Primero despublicá el producto o activá otra variante.";

export function publicationError(message) {
  const error = new Error(message);
  error.name = "AdminInputError";
  return error;
}

export function publicationGuard(db, violation, values) {
  // counters.value >= 0 is a database CHECK, so failure rolls back the batch.
  // Nothing is written when the assertion passes.
  return db.prepare("INSERT INTO counters(name,value) SELECT ?,-1 WHERE " + violation)
    .bind("publication-" + randomUUID(), ...values);
}
