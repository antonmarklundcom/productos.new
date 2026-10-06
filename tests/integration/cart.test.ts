import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { priceCart } from "@/domain/cart";
import { reserveStock } from "@/domain/stock";
import { categories, products, variants } from "@/db/schema";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createCategory, createOrder, createProduct, createVariant } from "../helpers/factories";

const inOneDay = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

describe.skipIf(!hasTestDb)("priceCart", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("cobra el precio de la DB, no el que manda el navegador", async () => {
    const variantId = await createVariant({ onHand: 10, pricePyg: 110000 });

    const cart = await priceCart([{ variantId, qty: 2 }], {
      expectedPrices: new Map([[variantId, 1]]), // el cliente "dice" ₲1
    });

    expect(cart.lines[0]?.unitPricePyg).toBe(110000);
    expect(cart.lines[0]?.lineTotalPyg).toBe(220000);
    expect(cart.subtotalPyg).toBe(220000);
    expect(cart.issues).toContainEqual(
      expect.objectContaining({ type: "precio_cambio", before: 1, after: 110000 })
    );
  });

  it("desglosa el IVA incluido por línea", async () => {
    const productId = await createProduct();
    const variantId = await createVariant({ onHand: 5, pricePyg: 110000, productId });

    const cart = await priceCart([{ variantId, qty: 3 }]);

    // 330.000 con IVA 10% incluido → 30.000
    expect(cart.iva10Pyg).toBe(30000);
    expect(cart.iva5Pyg).toBe(0);
  });

  it("recorta la cantidad al stock disponible y avisa", async () => {
    const variantId = await createVariant({ onHand: 3 });
    const otherOrder = await createOrder();
    await reserveStock(otherOrder, [{ variantId, qty: 2 }], { expiresAt: inOneDay() });

    const cart = await priceCart([{ variantId, qty: 3 }]);

    expect(cart.lines[0]?.qty).toBe(1);
    expect(cart.issues).toContainEqual(
      expect.objectContaining({ type: "stock_parcial", requested: 3, available: 1 })
    );
  });

  it("saca del carrito lo que se quedó sin stock", async () => {
    const variantId = await createVariant({ onHand: 1 });
    const otherOrder = await createOrder();
    await reserveStock(otherOrder, [{ variantId, qty: 1 }], { expiresAt: inOneDay() });

    const cart = await priceCart([{ variantId, qty: 1 }]);

    expect(cart.lines).toHaveLength(0);
    expect(cart.subtotalPyg).toBe(0);
    expect(cart.issues).toContainEqual(expect.objectContaining({ type: "no_disponible" }));
  });

  it("ignora variantes inexistentes o despublicadas", async () => {
    const db = getTestDb();
    const productId = await createProduct();
    const hidden = await createVariant({ onHand: 5, productId });
    await db.update(products).set({ isActive: false }).where(eq(products.id, productId));

    const inactiveVariant = await createVariant({ onHand: 5 });
    await db.update(variants).set({ isActive: false }).where(eq(variants.id, inactiveVariant));

    const cart = await priceCart([
      { variantId: hidden, qty: 1 },
      { variantId: inactiveVariant, qty: 1 },
      { variantId: 999999, qty: 1 },
    ]);

    expect(cart.lines).toHaveLength(0);
    expect(cart.issues).toHaveLength(3);
  });

  it("no vende lo que la vidriera no muestra: sin publicar o de una categoría apagada", async () => {
    const db = getTestDb();

    const borrador = await createProduct();
    const deBorrador = await createVariant({ onHand: 5, productId: borrador });
    await db.update(products).set({ publishedAt: null }).where(eq(products.id, borrador));

    const categoriaApagada = await createCategory();
    const deCategoriaApagada = await createVariant({
      onHand: 5,
      productId: await createProduct(categoriaApagada),
    });
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, categoriaApagada));

    // Un carrito viejo en localStorage, o un POST armado a mano con el id.
    const cart = await priceCart([
      { variantId: deBorrador, qty: 1 },
      { variantId: deCategoriaApagada, qty: 1 },
    ]);

    expect(cart.lines).toHaveLength(0);
    expect(cart.issues.map((issue) => issue.type)).toEqual(["no_disponible", "no_disponible"]);
  });

  it("junta líneas repetidas de la misma variante", async () => {
    const variantId = await createVariant({ onHand: 10, pricePyg: 50000 });

    const cart = await priceCart([
      { variantId, qty: 2 },
      { variantId, qty: 3 },
    ]);

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.qty).toBe(5);
    expect(cart.subtotalPyg).toBe(250000);
  });

  it("descarta cantidades imposibles sin explotar", async () => {
    const variantId = await createVariant({ onHand: 10 });
    const cart = await priceCart([
      { variantId, qty: 0 },
      { variantId: -1, qty: 2 },
      { variantId, qty: 1.5 },
    ]);
    expect(cart).toMatchObject({ lines: [], subtotalPyg: 0 });
  });

  it("un carrito vacío no toca la base", async () => {
    expect(await priceCart([])).toMatchObject({ lines: [], subtotalPyg: 0, issues: [] });
  });
});
