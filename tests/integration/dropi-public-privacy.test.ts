import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getCatalog, getCategoryProducts, getFeedProducts, getProductBySlug, getProductsBySlugs, getSitemapEntries, searchProducts, suggestProducts } from "@/db/queries";
import { products } from "@/db/schema";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createCategory, createProduct, createVariant } from "../helpers/factories";

describe.skipIf(!hasTestDb)("private supplier URL never reaches public catalog data", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("persists in admin storage but is absent from all storefront projections", async () => {
    const db = getTestDb();
    const categoryId = await createCategory("hogar-privacy-test");
    const productId = await createProduct(categoryId);
    const dropiUrl = "https://app.dropi.com.py/dashboard/product-details/10067/cepillo-limpiador-con-dispenser-de-jabon";
    await db.update(products).set({name:"Cepillo limpiador privado",slug:"cepillo-privacy-test",dropiUrl}).where(eq(products.id,productId));
    await createVariant({productId,onHand:3});
    const [stored] = await db.select({dropiUrl:products.dropiUrl}).from(products).where(eq(products.id,productId));
    expect(stored?.dropiUrl).toBe(dropiUrl);
    const projections = await Promise.all([
      getCatalog(),
      getCategoryProducts({categorySlug:"hogar-privacy-test"}),
      getProductBySlug("cepillo-privacy-test"),
      getProductsBySlugs(["cepillo-privacy-test"]),
      searchProducts("Cepillo"),
      suggestProducts("Cepillo"),
      getFeedProducts(),
      getSitemapEntries(),
    ]);
    expect(projections[2]).toMatchObject({id:productId,name:"Cepillo limpiador privado"});
    const publicData=JSON.stringify(projections);
    expect(publicData).not.toContain("dropiUrl");
    expect(publicData).not.toContain("dropi_url");
    expect(publicData).not.toContain("app.dropi.com.py");
    expect(publicData).not.toContain(dropiUrl);
  });
});
