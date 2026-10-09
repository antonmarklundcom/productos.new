import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { supplierOffers, variants } from "@/db/schema";
import type { Executor } from "./executor";

export type SupplierOffer = typeof supplierOffers.$inferSelect;
export type SupplierOfferWrite = Omit<
  typeof supplierOffers.$inferInsert,
  "id" | "variantId" | "updatedAt"
>;
export type SupplierCostWrite = {
  unitCostPyg: number | null;
  source: string | null;
  checkedAt: Date | null;
};

/** A deployment may precede its additive migration. No permanent negative cache. */
export async function supplierCostsReady(executor: Executor = getDb()) {
  const [row] = await executor
    .select({ count: sql<number>`COUNT(*)` })
    .from(sql`information_schema.COLUMNS`)
    .where(
      sql`TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_offers' AND COLUMN_NAME IN ('id','variant_id','unit_cost_pyg','source','source_type','product_url','supplier_url','supplier_stock','notes','is_confirmed','is_active','is_preferred','checked_at','updated_at')`
    );
  return Number(row?.count) === 14;
}

/** Caller holds the variant row lock in this transaction. */
export async function writeSupplierOffer(
  variantId: number,
  offerId: number | undefined,
  input: SupplierOfferWrite,
  tx: Executor
) {
  if (
    input.isPreferred &&
    (!input.isActive || !input.isConfirmed || input.unitCostPyg == null)
  )
    throw new Error(
      "El proveedor preferido debe estar activo, confirmado y tener costo."
    );
  if (offerId !== undefined) {
    const [existing] = await tx
      .select({ id: supplierOffers.id })
      .from(supplierOffers)
      .where(
        and(
          eq(supplierOffers.id, offerId),
          eq(supplierOffers.variantId, variantId)
        )
      );
    if (!existing) throw new Error("La oferta no pertenece a esta variante.");
  }
  if (input.isPreferred)
    await tx
      .update(supplierOffers)
      .set({ isPreferred: false })
      .where(eq(supplierOffers.variantId, variantId));
  if (offerId === undefined)
    await tx.insert(supplierOffers).values({ ...input, variantId });
  else
    await tx
      .update(supplierOffers)
      .set(input)
      .where(
        and(
          eq(supplierOffers.id, offerId),
          eq(supplierOffers.variantId, variantId)
        )
      );
}

/** CSV updates the named source and retains other supplier alternatives. */
export async function writeSupplierCost(
  variantId: number,
  input: SupplierCostWrite,
  executor?: Executor
) {
  const apply = async (tx: Executor) => {
    const [variant] = await tx
      .select({ id: variants.id })
      .from(variants)
      .where(eq(variants.id, variantId))
      .for("update");
    if (!variant) throw new Error("La variante no existe.");
    const offers = await tx
      .select()
      .from(supplierOffers)
      .where(eq(supplierOffers.variantId, variantId))
      .orderBy(asc(supplierOffers.id));
    const candidates = offers.filter((offer) => offer.source === input.source);
    if (candidates.length > 1)
      throw new Error(
        "Hay varias ofertas de esta fuente. Editá la oferta concreta en el panel."
      );
    const matching = candidates[0];
    const preferred =
      matching?.isPreferred ?? !offers.some((offer) => offer.isPreferred);
    await writeSupplierOffer(
      variantId,
      matching?.id,
      {
        ...input,
        sourceType: matching?.sourceType ?? "other",
        productUrl: matching?.productUrl ?? null,
        supplierUrl: matching?.supplierUrl ?? null,
        supplierStock: matching?.supplierStock ?? null,
        notes: matching?.notes ?? null,
        isConfirmed: matching?.isConfirmed ?? false,
        isActive: matching?.isActive ?? true,
        isPreferred:
          preferred &&
          Boolean(matching?.isConfirmed) &&
          input.unitCostPyg !== null,
      },
      tx
    );
  };
  await (executor ?? getDb()).transaction(apply);
}

export async function readSupplierOffers(
  variantIds: number[],
  executor: Executor = getDb()
) {
  if (!variantIds.length || !(await supplierCostsReady(executor))) return [];
  return executor
    .select()
    .from(supplierOffers)
    .where(inArray(supplierOffers.variantId, variantIds))
    .orderBy(asc(supplierOffers.variantId), asc(supplierOffers.id));
}

export async function readSupplierCosts(
  variantIds: number[],
  executor: Executor = getDb()
) {
  const rows = await readSupplierOffers(variantIds, executor);
  return new Map(
    rows
      .filter((row) => row.isActive && row.isConfirmed && row.isPreferred)
      .map((row) => [row.variantId, row])
  );
}
