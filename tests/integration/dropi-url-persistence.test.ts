import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { products, variants } from "@/db/schema";
import { createProduct, updateProduct, getAdminProduct, type ProductWrite } from "@/domain/admin-products";
import { duplicateProduct } from "@/domain/admin-bulk";
import { parseCatalogo } from "@/domain/catalog-import";
import { upsertCatalogProducts } from "../../scripts/seed";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createCategory } from "../helpers/factories";

const url = "https://app.dropi.com.py/dashboard/product-details/10067/cepillo-limpiador-con-dispenser-de-jabon";
const replacement = "https://app.dropi.com.py/dashboard/product-details/12875/picador-de-verduras-4en1";
const productInput = (categoryId: number): ProductWrite => ({
  slug: "cepillo", name: "Cepillo", description: null, categoryId,
  brand: null, ivaRate: 10, isActive: true, published: true,
});

describe.skipIf(!hasTestDb)("private Dropi URL persistence", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("persists CSV links and preserves them when a later import omits the column", async () => {
    const categoryId = await createCategory("hogar");
    const parsed = parseCatalogo(`SKU,Producto,Categoría,Precio,Stock,Slug,Dropi URL\nD1,Cepillo,Hogar,50000,5,cepillo,${url}`);
    expect(parsed.errores).toEqual([]);
    const source = parsed.productos[0]!;
    await upsertCatalogProducts([{ ...source, categoryId }]);
    const first = (await getTestDb().select().from(products))[0]!;
    expect(first.dropiUrl).toBe(url);
    const { dropiUrl, ...omitted } = source;
    expect(dropiUrl).toBe(url);
    await upsertCatalogProducts([{ ...omitted, categoryId, variants: [{ ...source.variants[0]!, onHand: 99 }] }]);
    expect((await getAdminProduct(first.id))?.product.dropiUrl).toBe(url);
    const stock = await getTestDb().select().from(variants).where(eq(variants.productId, first.id));
    expect(stock[0]?.onHand).toBe(5);
    await upsertCatalogProducts([{ ...source, categoryId, dropiUrl: replacement }]);
    expect((await getAdminProduct(first.id))?.product.dropiUrl).toBe(replacement);
    await upsertCatalogProducts([{ ...source, categoryId, dropiUrl: null }]);
    expect((await getAdminProduct(first.id))?.product.dropiUrl).toBeNull();
  });

  it("admin edits preserve omitted links and explicitly clear blanks", async () => {
    const input = productInput(await createCategory());
    const id = await createProduct({ ...input, dropiUrl: url });
    await updateProduct(id, { ...input, name: "Cepillo actualizado" });
    expect((await getAdminProduct(id))?.product.dropiUrl).toBe(url);
    await updateProduct(id, { ...input, dropiUrl: replacement });
    expect((await getAdminProduct(id))?.product.dropiUrl).toBe(replacement);
    await updateProduct(id, { ...input, dropiUrl: " " });
    expect((await getAdminProduct(id))?.product.dropiUrl).toBeNull();
  });

  it("copies the supplier reference when duplicating a product", async () => {
    const input = productInput(await createCategory());
    const originalId = await createProduct({ ...input, dropiUrl: url });
    const copyId = await duplicateProduct(originalId);
    const copy = await getAdminProduct(copyId);
    expect(copy?.product.dropiUrl).toBe(url);
    expect(copy?.product.isActive).toBe(false);
    expect(copy?.product.publishedAt).toBeNull();
    expect((await getAdminProduct(originalId))?.product.dropiUrl).toBe(url);
  });
});
