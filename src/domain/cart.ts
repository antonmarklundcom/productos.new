import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { categories, products, variants } from "@/db/schema";
import { assertGs, ivaBreakdown, lineTotal } from "@/lib/money";

import type { CartIssue } from "@/lib/cart-issues";

import type { Executor } from "./executor";
import { heldQtyMap } from "./stock";

export type { CartIssue };

/**
 * Re-valuación del carrito contra la DB (PLAN.md 2.8).
 *
 * El navegador manda variantes y cantidades; todo lo demás — precio, nombre,
 * IVA, stock — se vuelve a leer acá. Si el precio cambió o se acabó el stock
 * mientras el carrito dormía en localStorage, se ajusta la línea y se avisa,
 * en vez de dejar que el checkout cobre un precio viejo.
 */

export type CartInput = { variantId: number; qty: number };

export type PricedLine = {
  variantId: number;
  productSlug: string;
  name: string;
  variantLabel: string;
  sku: string;
  unitPricePyg: number;
  qty: number;
  lineTotalPyg: number;
  ivaRate: number;
  available: number;
};

export type PricedCart = {
  lines: PricedLine[];
  subtotalPyg: number;
  iva10Pyg: number;
  iva5Pyg: number;
  issues: CartIssue[];
};

export const EMPTY_CART: PricedCart = {
  lines: [],
  subtotalPyg: 0,
  iva10Pyg: 0,
  iva5Pyg: 0,
  issues: [],
};

/**
 * @param input  lo que dice el navegador
 * @param expectedPrices  precio que el navegador venía mostrando por variante,
 *   sólo para poder avisar "cambió el precio". Nunca se usa para cobrar.
 */
export async function priceCart(
  input: readonly CartInput[],
  options: { expectedPrices?: Map<number, number>; executor?: Executor } = {}
): Promise<PricedCart> {
  const wanted = normalize(input);
  if (wanted.length === 0) return EMPTY_CART;

  const tx = options.executor ?? getDb();
  const rows = await tx
    .select({
      variantId: variants.id,
      sku: variants.sku,
      variantLabel: variants.label,
      pricePyg: variants.pricePyg,
      onHand: variants.onHand,
      variantActive: variants.isActive,
      productSlug: products.slug,
      name: products.name,
      ivaRate: products.ivaRate,
      productActive: products.isActive,
      saleMode: products.saleMode,
      showPrice: products.showPrice,
      publishedAt: products.publishedAt,
      categoryActive: categories.isActive,
    })
    .from(variants)
    .innerJoin(products, eq(variants.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        inArray(
          variants.id,
          wanted.map((item) => item.variantId)
        )
      )
    );

  const byVariant = new Map(rows.map((row) => [row.variantId, row]));
  const held = await heldQtyMap(
    rows.map((row) => row.variantId),
    tx
  );

  const lines: PricedLine[] = [];
  const issues: CartIssue[] = [];

  for (const item of wanted) {
    const row = byVariant.get(item.variantId);

    // El mismo criterio que la vidriera (`PUBLISHED` en src/db/queries.ts):
    // lo que no se puede ver tampoco se puede comprar con un carrito viejo o
    // un POST armado a mano — un producto cargado para el lanzamiento del
    // viernes no se vende el jueves.
    if (
      !row ||
      !row.variantActive ||
      !row.productActive ||
      row.publishedAt === null ||
      !row.categoryActive
    ) {
      issues.push({
        type: "no_disponible",
        variantId: item.variantId,
        name: row?.name ?? `Variante ${item.variantId}`,
      });
      continue;
    }

    const available = Math.max(0, row.onHand - (held.get(row.variantId) ?? 0));
    if (row.saleMode !== "stock" || !row.showPrice) {
      issues.push({
        type: "solo_consulta",
        variantId: item.variantId,
        name: row.name,
      });
      continue;
    }
    const displayName = `${row.name} — ${row.variantLabel}`;

    if (available <= 0) {
      issues.push({
        type: "no_disponible",
        variantId: row.variantId,
        name: displayName,
      });
      continue;
    }

    const qty = Math.min(item.qty, available);
    if (qty < item.qty) {
      issues.push({
        type: "stock_parcial",
        variantId: row.variantId,
        name: displayName,
        requested: item.qty,
        available,
      });
    }

    const expected = options.expectedPrices?.get(row.variantId);
    if (expected !== undefined && expected !== row.pricePyg) {
      issues.push({
        type: "precio_cambio",
        variantId: row.variantId,
        name: displayName,
        before: expected,
        after: row.pricePyg,
      });
    }

    lines.push({
      variantId: row.variantId,
      productSlug: row.productSlug,
      name: row.name,
      variantLabel: row.variantLabel,
      sku: row.sku,
      unitPricePyg: assertGs(row.pricePyg, row.sku),
      qty,
      lineTotalPyg: lineTotal(row.pricePyg, qty),
      ivaRate: row.ivaRate,
      available,
    });
  }

  const subtotalPyg = lines.reduce(
    (total, line) => total + line.lineTotalPyg,
    0
  );
  const { iva10Pyg, iva5Pyg } = ivaBreakdown(lines);

  return { lines, subtotalPyg, iva10Pyg, iva5Pyg, issues };
}

/** Deduplica por variante y descarta cantidades imposibles. */
function normalize(input: readonly CartInput[]): CartInput[] {
  const merged = new Map<number, number>();
  for (const item of input) {
    if (!Number.isInteger(item.variantId) || item.variantId <= 0) continue;
    if (!Number.isInteger(item.qty) || item.qty <= 0) continue;
    merged.set(
      item.variantId,
      Math.min(99, (merged.get(item.variantId) ?? 0) + item.qty)
    );
  }
  return [...merged].map(([variantId, qty]) => ({ variantId, qty }));
}
