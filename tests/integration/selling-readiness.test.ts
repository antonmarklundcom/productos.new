import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bankDetails,
  orders,
  products,
  stockReservations,
  variants,
} from "@/db/schema";
import {
  getCategoryProducts,
  getFeedProducts,
  getProductBySlug,
} from "@/db/queries";
import { createOrder, type CreateOrderInput } from "@/domain/create-order";
import { priceCart } from "@/domain/cart";
import { readyPaymentMethods } from "@/domain/payment-readiness";
import { productInquiryLinks } from "@/domain/product-inquiries";
import { productJsonLd } from "@/lib/seo";
import { publicarFoto } from "@/lib/integraciones";
import {
  closeTestDb,
  getTestDb,
  hasTestDb,
  resetTables,
  seedPaymentReadiness,
} from "../helpers/db";
import {
  createCategory,
  createProduct,
  createVariant,
} from "../helpers/factories";

describe.skipIf(!hasTestDb)("selling modes and usable payments", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("WHATSAPP_NUMBER", "");
    publicarFoto({});
    await resetTables();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    publicarFoto({});
    await closeTestDb();
  });
  const purchase = (
    variantId: number,
    paymentMethod: CreateOrderInput["paymentMethod"]
  ): CreateOrderInput => ({
    items: [{ variantId, qty: 1 }],
    customerName: "Test Buyer",
    customerPhone: "0981123456",
    docType: "NINGUNO",
    isConsumidorFinal: true,
    shipCity: "Asunción",
    shipAddress: "Test 123",
    paymentMethod,
  });
  it("rejects unconfigured payments, then rechecks removal before creating an order", async () => {
    const variantId = await createVariant({ onHand: 20 });
    expect(await readyPaymentMethods()).toEqual(["contra_entrega"]);
    for (const method of ["transferencia", "tarjeta"] as const) {
      await expect(
        createOrder(purchase(variantId, method))
      ).rejects.toMatchObject({ code: "error.checkout.pagoNoDisponible" });
    }
    expect(await getTestDb().select().from(orders)).toHaveLength(0);
    expect(await getTestDb().select().from(stockReservations)).toHaveLength(0);
    await seedPaymentReadiness();
    expect(await readyPaymentMethods()).toEqual([
      "transferencia",
      "contra_entrega",
      "tarjeta",
    ]);
    await createOrder(purchase(variantId, "transferencia"));
    await getTestDb().delete(bankDetails);
    await expect(
      createOrder(purchase(variantId, "transferencia"))
    ).rejects.toMatchObject({ code: "error.checkout.pagoNoDisponible" });
    expect(await getTestDb().select().from(orders)).toHaveLength(1);
  });
  it.each(["enquiry", "showcase"] as const)(
    "%s rejects forged cart and checkout even with stock",
    async (saleMode) => {
      const productId = await createProduct();
      const variantId = await createVariant({
        productId,
        onHand: 50,
        pricePyg: 123456,
      });
      await getTestDb()
        .update(products)
        .set({ saleMode, showPrice: false })
        .where(eq(products.id, productId));
      const cart = await priceCart([{ variantId, qty: 1 }]);
      expect(cart.lines).toEqual([]);
      expect(cart.issues).toMatchObject([{ type: "solo_consulta" }]);
      await expect(
        createOrder(purchase(variantId, "contra_entrega"))
      ).rejects.toMatchObject({ code: "error.checkout.noDisponible" });
      expect(await getTestDb().select().from(orders)).toEqual([]);
      expect(await getFeedProducts()).toEqual([]);
      const [row] = await getTestDb()
        .select()
        .from(products)
        .where(eq(products.id, productId));
      const catalog = await getProductBySlug(row!.slug);
      expect(catalog!.variants[0]!.pricePyg).toBe(0);
      expect(catalog!.variants[0]!.compareAtPyg).toBeNull();
      expect(await productInquiryLinks(catalog!)).toEqual({});
      const ld = productJsonLd({ ...catalog!, origin: null, images: [] });
      expect(JSON.parse(JSON.stringify(ld))).not.toHaveProperty("offers");
      expect(JSON.stringify(ld)).not.toContain("123456");
    }
  );
  it("hidden prices are excluded from price filtering, while stock products remain purchasable", async () => {
    const categoryId = await createCategory("price-filter");
    const visible = await createProduct(categoryId);
    const hidden = await createProduct(categoryId);
    const variantId = await createVariant({
      productId: visible,
      onHand: 5,
      pricePyg: 50000,
    });
    await createVariant({ productId: hidden, onHand: 5, pricePyg: 60000 });
    await getTestDb()
      .update(products)
      .set({ saleMode: "enquiry", showPrice: false })
      .where(eq(products.id, hidden));
    const filtered = await getCategoryProducts({
      categorySlug: "price-filter",
      minPricePyg: 1,
      maxPricePyg: 100000,
    });
    expect(filtered.products.map((product) => product.id)).toEqual([visible]);
    expect((await priceCart([{ variantId, qty: 1 }])).lines).toHaveLength(1);
    expect((await getFeedProducts()).map((product) => product.id)).toEqual([
      visible,
    ]);
    const [v] = await getTestDb()
      .select()
      .from(variants)
      .where(eq(variants.id, variantId));
    expect(v!.onHand).toBe(5);
  });
});
