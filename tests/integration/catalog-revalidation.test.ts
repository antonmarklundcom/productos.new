import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { products, variants } from "@/db/schema";
import {
  applyCatalogImport,
  saveProductVariant,
} from "@/app/actions/admin-products";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import {
  createAdminUser,
  createProduct,
  createVariant,
} from "../helpers/factories";

const mocks = vi.hoisted(() => ({
  session: {
    userId: 0,
    role: "owner",
    email: "test@example.test",
    sessionVersion: 1,
  },
  revalidate: vi.fn(),
}));
vi.mock("@/lib/session", async (original) => ({
  ...(await original<typeof import("@/lib/session")>()),
  getSession: async () => mocks.session,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
describe.skipIf(!hasTestDb)("catalog updates invalidate public pages", () => {
  beforeEach(async () => {
    await resetTables();
    mocks.session.userId = await createAdminUser();
    mocks.revalidate.mockClear();
  });
  afterAll(closeTestDb);
  const expectPublicInvalidation = () => {
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  };
  it("a price change is committed and invalidates home/category caches", async () => {
    const productId = await createProduct();
    const variantId = await createVariant({ productId, onHand: 5 });
    const [variant] = await getTestDb()
      .select()
      .from(variants)
      .where(eq(variants.id, variantId));
    expect(
      await saveProductVariant({
        productId,
        variantId,
        sku: variant!.sku,
        label: "Updated",
        pricePyg: 70000,
        isActive: true,
      })
    ).toEqual({ ok: true });
    const [updated] = await getTestDb()
      .select()
      .from(variants)
      .where(eq(variants.id, variantId));
    expect(updated!.pricePyg).toBe(70000);
    expectPublicInvalidation();
  });
  it("a photo-free CSV import commits the product and invalidates public pages", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(
        [
          "SKU;Producto;Categoría;Variante;Precio (₲);Stock\nCACHE-1;Imported item;Cache category;Unique;75000;5\n",
        ],
        "catalog.csv",
        { type: "text/csv" }
      )
    );
    const result = await applyCatalogImport(form);
    expect(result).toMatchObject({
      ok: true,
      fotosSubidas: 0,
      variantesEscritas: 1,
    });
    expect(
      await getTestDb()
        .select()
        .from(products)
        .where(eq(products.slug, "imported-item"))
    ).toHaveLength(1);
    expectPublicInvalidation();
  });
});
