import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getNativeDb, type NativeDatabase } from "./database";
import { supplierOffers, variants } from "./schema";
export type SupplierOffer = typeof supplierOffers.$inferSelect;
export type SupplierOfferWrite = Omit<typeof supplierOffers.$inferInsert, "id" | "variantId" | "updatedAt">;
export type SupplierCostWrite = {unitCostPyg: number | null; source: string | null; checkedAt: Date | null};
export async function supplierCostsReady() {
  const rows = await getNativeDb().all<{name:string}>(sql`PRAGMA table_info(supplier_offers)`);
  const names = new Set(rows.map((row) => row.name));
  return ["id","variant_id","unit_cost_pyg","source","source_type","product_url","supplier_url","supplier_stock","notes","is_confirmed","is_active","is_preferred","checked_at","updated_at"].every((name) => names.has(name));
}
export async function readSupplierOffers(variantIds: number[]) {
  if (!variantIds.length || !(await supplierCostsReady())) return [];
  return getNativeDb().select().from(supplierOffers).where(inArray(supplierOffers.variantId, variantIds)).orderBy(asc(supplierOffers.variantId), asc(supplierOffers.id));
}
export async function readSupplierCosts(variantIds: number[]) {
  return new Map((await readSupplierOffers(variantIds)).filter((offer) => offer.isActive && offer.isConfirmed && offer.isPreferred).map((offer) => [offer.variantId, offer]));
}

/** Native D1 batch makes switching the preferred offer atomic. */
export async function saveD1SupplierOffer(productId: number, variantId: number, offerId: number | undefined, input: SupplierOfferWrite) {
  const db = getNativeDb();
  if (input.isPreferred && (!input.isActive || !input.isConfirmed || input.unitCostPyg == null)) throw new Error("El proveedor preferido debe estar activo, confirmado y tener costo.");
  if (input.unitCostPyg != null && (!Number.isSafeInteger(input.unitCostPyg) || input.unitCostPyg < 0)) throw new Error("Costo inválido.");
  const [variant] = await db.select({id: variants.id}).from(variants).where(and(eq(variants.id, variantId), eq(variants.productId, productId)));
  if (!variant) throw new Error("La variante no existe.");
  if (offerId !== undefined) {
    const [offer] = await db.select({id:supplierOffers.id}).from(supplierOffers).where(and(eq(supplierOffers.id,offerId),eq(supplierOffers.variantId,variantId)));
    if (!offer) throw new Error("La oferta no pertenece a esta variante.");
  }
  const save = offerId === undefined ? db.insert(supplierOffers).values({...input,variantId}) : db.update(supplierOffers).set(input).where(and(eq(supplierOffers.id,offerId),eq(supplierOffers.variantId,variantId)));
  if (input.isPreferred) await db.batch([db.update(supplierOffers).set({isPreferred:false}).where(eq(supplierOffers.variantId,variantId)), save]);
  else await db.batch([save]);
}
export async function writeSupplierOffer(_variantId:number, _offerId:number|undefined, _input:SupplierOfferWrite, _executor?:NativeDatabase): Promise<never> { void [_variantId,_offerId,_input,_executor]; throw new Error("D1_STAGING_USE_ATOMIC_SUPPLIER_SAVE"); }
export async function writeSupplierCost(_variantId:number, _input:SupplierCostWrite): Promise<never> { void [_variantId,_input]; throw new Error("D1_STAGING_IMPORT_NOT_PORTED"); }
