import { executeAdminBatch } from "./admin-batch";
import { catalogConflict } from "./catalog-durability";
import { requireStaffSession } from "../../src/lib/admin-guard";
import { catalogAudit, products } from "./schema";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getNativeDb, type NativeDatabase } from "./database";
import { normalizeDropiUrl } from "../../src/domain/catalog-import";
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

export const dropiReviewDays = 30;
const dropiQueuePageSize = 25;

type DropiFreshnessRow = {
  offerId: number;
  productId: number;
  productName: string;
  variantLabel: string;
  sku: string;
  variantActive: number;
  supplierName: string | null;
  productUrl: string | null;
  confirmed: number;
  retailPyg: number;
  costPyg: number | null;
  supplierStock: number | null;
  checkedAt: string | null;
  freshness: "unknown" | "stale" | "fresh";
};

export async function readDropiFreshness(
  db: Pick<NativeDatabase, "all">,
  page: number,
  now = new Date(),
) {
  const cutoff = new Date(now.getTime() - dropiReviewDays * 86_400_000);
  const rows = await db.all<DropiFreshnessRow>(sql`
    SELECT s.id AS offerId, p.id AS productId, p.name AS productName,
      v.label AS variantLabel, v.sku, v.is_active AS variantActive,
      s.source AS supplierName, s.product_url AS productUrl, s.is_confirmed AS confirmed,
      v.price_pyg AS retailPyg, s.unit_cost_pyg AS costPyg, s.supplier_stock AS supplierStock,
      strftime('%Y-%m-%dT%H:%M:%SZ',s.checked_at) AS checkedAt,
      CASE
        WHEN julianday(s.checked_at) IS NULL OR julianday(s.checked_at) > julianday(${now.toISOString()}) THEN 'unknown'
        WHEN julianday(s.checked_at) <= julianday(${cutoff.toISOString()}) THEN 'stale'
        ELSE 'fresh'
      END AS freshness
    FROM supplier_offers s
    JOIN variants v ON v.id=s.variant_id JOIN products p ON p.id=v.product_id
    WHERE s.source_type='dropi' AND s.is_active=1
    ORDER BY CASE freshness WHEN 'unknown' THEN 0 WHEN 'stale' THEN 1 ELSE 2 END,
      s.is_confirmed, julianday(s.checked_at), s.id
    LIMIT ${dropiQueuePageSize + 1} OFFSET ${(page - 1) * dropiQueuePageSize}
  `);

  return {
    hasNext: rows.length > dropiQueuePageSize,
    rows: rows.slice(0, dropiQueuePageSize).map(row => {
      let productUrl: string | null = null;
      try {
        productUrl = normalizeDropiUrl(row.productUrl) ?? null;
      } catch {
        // Keep a legacy invalid link reviewable without exposing it as a link.
      }
      return {
        ...row,
        productUrl,
        dropiId: productUrl?.match(/\/product-details\/(\d+)\//)?.[1] ?? null,
      };
    }),
  };
}

/** Native D1 batch makes switching the preferred offer atomic. */
export async function saveD1SupplierOffer(productId: number, variantId: number, offerId: number | undefined, input: SupplierOfferWrite, expectedRevision:number) {
  const actor=await requireStaffSession();
  return writeD1SupplierOffer(getNativeDb(),actor.userId,productId,variantId,offerId,input,expectedRevision);
}
export async function writeD1SupplierOffer(db:ReturnType<typeof getNativeDb>,actorId:number,productId:number,variantId:number,offerId:number|undefined,input:SupplierOfferWrite,expectedRevision:number){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw catalogConflict();
  if (input.isPreferred && (!input.isActive || !input.isConfirmed || input.unitCostPyg == null)) throw new Error("El proveedor preferido debe estar activo, confirmado y tener costo.");
  if (input.unitCostPyg != null && (!Number.isSafeInteger(input.unitCostPyg) || input.unitCostPyg < 0)) throw new Error("Costo inválido.");
  const [variant] = await db.select({id: variants.id}).from(variants).where(and(eq(variants.id, variantId), eq(variants.productId, productId)));
  if (!variant) throw new Error("La variante no existe.");
  if (offerId !== undefined) {
    const [offer] = await db.select({id:supplierOffers.id}).from(supplierOffers).where(and(eq(supplierOffers.id,offerId),eq(supplierOffers.variantId,variantId)));
    if (!offer) throw new Error("La oferta no pertenece a esta variante.");
  }
  const save = offerId === undefined ? db.insert(supplierOffers).values({...input,variantId}) : db.update(supplierOffers).set(input).where(and(eq(supplierOffers.id,offerId),eq(supplierOffers.variantId,variantId)));
  const revision=db.update(products).set({revision:sql`${products.revision}+1`}).where(eq(products.id,productId));
  const audit=db.insert(catalogAudit).values({id:randomUUID(),actorId,operation:"save-supplier",recordType:"product",recordId:productId,revision:sql`(SELECT revision FROM products WHERE id=${productId})`,fields:JSON.stringify(["supplierOffers"])});
  try{if (input.isPreferred) await executeAdminBatch(db,[db.run(sql`INSERT INTO counters(name,value) SELECT ${randomUUID()},-1 WHERE NOT EXISTS(SELECT 1 FROM products WHERE id=${productId} AND revision=${expectedRevision})`),db.update(supplierOffers).set({isPreferred:false}).where(eq(supplierOffers.variantId,variantId)), save,revision,audit]);
  else await executeAdminBatch(db,[db.run(sql`INSERT INTO counters(name,value) SELECT ${randomUUID()},-1 WHERE NOT EXISTS(SELECT 1 FROM products WHERE id=${productId} AND revision=${expectedRevision})`),save,revision,audit]);
  }catch(error){const row=await db.select({revision:products.revision}).from(products).where(eq(products.id,productId));if(row[0]?.revision!==expectedRevision)throw catalogConflict();throw error;}
}
export async function writeSupplierOffer(_variantId:number, _offerId:number|undefined, _input:SupplierOfferWrite, _executor?:NativeDatabase): Promise<never> { void [_variantId,_offerId,_input,_executor]; throw new Error("D1_STAGING_USE_ATOMIC_SUPPLIER_SAVE"); }
export async function writeSupplierCost(_variantId:number, _input:SupplierCostWrite): Promise<never> { void [_variantId,_input]; throw new Error("D1_STAGING_IMPORT_NOT_PORTED"); }
