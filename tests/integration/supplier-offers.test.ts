import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { products, supplierOffers, variants } from "../../src/db/schema";
import {
  listAdminProducts,
  listVariantsForExport,
  getAdminProduct,
} from "../../src/domain/admin-products";
import {
  writeSupplierCost,
  writeSupplierOffer,
} from "../../src/domain/supplier-costs";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createCategory } from "../helpers/factories";

describe.skipIf(!hasTestDb)("private supplier alternatives", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);
  async function fixture() {
    const db = getTestDb();
    const categoryId = await createCategory();
    const [productRow] = await db
      .insert(products)
      .values({ slug: "supplier-product", name: "Proveedor", categoryId })
      .$returningId();
    const productId = productRow!.id;
    const [variantRow] = await db
      .insert(variants)
      .values({
        productId,
        sku: "supplier-test",
        label: "Única",
        pricePyg: 69000,
        onHand: 7,
      })
      .$returningId();
    return { db, productId, variantId: variantRow!.id };
  }
  async function save(
    variantId: number,
    source: string,
    cost: number,
    preferred: boolean,
    confirmed = true,
    offerId?: number
  ) {
    await getTestDb().transaction(async (tx) => {
      await tx
        .select()
        .from(variants)
        .where(eq(variants.id, variantId))
        .for("update");
      await writeSupplierOffer(
        variantId,
        offerId,
        {
          source,
          unitCostPyg: cost,
          sourceType: "dropi",
          isActive: true,
          isConfirmed: confirmed,
          isPreferred: preferred,
          checkedAt: null,
        },
        tx
      );
    });
  }
  it("retains alternatives, switches preferred atomically and never multiplies stock or variant counts", async () => {
    const { db, productId, variantId } = await fixture();
    await save(variantId, "MarketPro", 23000, true);
    await save(variantId, "Wit", 18000, false, false);
    const [wit] = await db
      .select()
      .from(supplierOffers)
      .where(eq(supplierOffers.source, "Wit"));
    const first = (await listAdminProducts()).rows[0]!;
    expect(first.minCostPyg).toBe(23000);
    expect(first.variantCount).toBe(1);
    expect(first.onHand).toBe(7);
    expect(
      (await getAdminProduct(productId))?.variants[0]?.supplierOffers
    ).toHaveLength(2);
    await expect(
      save(variantId, "Wit", 18000, true, false, wit!.id)
    ).rejects.toThrow("confirmado");
    await save(variantId, "Wit", 18000, true, true, wit!.id);
    const preferred = await db
      .select()
      .from(supplierOffers)
      .where(
        and(
          eq(supplierOffers.variantId, variantId),
          eq(supplierOffers.isPreferred, true)
        )
      );
    expect(preferred).toHaveLength(1);
    expect(preferred[0]!.source).toBe("Wit");
    expect((await listVariantsForExport())[0]!.unitCostPyg).toBe(18000);
  });
  it("CSV keeps new offers pending and preserves the preferred supplier when another source is imported", async () => {
    const { db, variantId } = await fixture();
    await save(variantId, "MarketPro", 23000, true);
    await writeSupplierCost(variantId, {
      source: "Wit",
      unitCostPyg: 18000,
      checkedAt: null,
    });
    await writeSupplierCost(variantId, {
      source: "Wit",
      unitCostPyg: 19000,
      checkedAt: null,
    });
    const offers = await db
      .select()
      .from(supplierOffers)
      .where(eq(supplierOffers.variantId, variantId));
    expect(offers).toHaveLength(2);
    expect(offers.find((o) => o.source === "Wit")!.isConfirmed).toBe(false);
    expect((await listAdminProducts()).rows[0]!.minCostPyg).toBe(23000);
  });
  it("rejects editing another variant's offer and leaves the old preference unchanged", async () => {
    const { db, productId, variantId } = await fixture();
    await save(variantId, "A", 23000, true);
    const [offer] = await db.select().from(supplierOffers);
    const [otherRow] = await db
      .insert(variants)
      .values({
        productId,
        sku: "other-supplier-test",
        label: "Otra",
        pricePyg: 69000,
      })
      .$returningId();
    await expect(
      save(otherRow!.id, "B", 10000, true, true, offer!.id)
    ).rejects.toThrow("no pertenece");
    expect((await db.select().from(supplierOffers))[0]!.isPreferred).toBe(true);
  });
});
