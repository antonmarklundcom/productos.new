import { effectiveSaleMode } from "@/lib/catalog-policy";

/** Stock sales prefer available variants; enquiries have no stock promise. */
export function displayedVariant<T extends {pricePyg: number; available: number}>(product: {saleMode?: "stock" | "enquiry" | "showcase"; variants: T[]}): T | undefined {
  const available = effectiveSaleMode(product.saleMode) === "stock" ? product.variants.filter(v => v.available > 0) : [];
  return (available.length ? available : product.variants).reduce<T | undefined>((best, v) => !best || v.pricePyg < best.pricePyg ? v : best, undefined);
}
