import { describe, expect, it } from "vitest";

import {
  CART_STORAGE_VERSION,
  cartCount,
  cartSubtotal,
  migrateCart,
  type CartLine,
} from "@/lib/cart-store";

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  variantId: 1,
  qty: 2,
  productSlug: "remera-algodon-basica",
  name: "Remera de algodón básica",
  variantLabel: "Talle M",
  unitPricePyg: 85000,
  ...overrides,
});

describe("totales del carrito", () => {
  it("cuenta unidades, no líneas", () => {
    expect(cartCount([line({ qty: 2 }), line({ variantId: 2, qty: 3 })])).toBe(5);
  });

  it("el subtotal es entero en guaraníes", () => {
    const subtotal = cartSubtotal([
      line({ qty: 2, unitPricePyg: 85000 }),
      line({ variantId: 2, qty: 1, unitPricePyg: 245000 }),
    ]);
    expect(subtotal).toBe(415000);
    expect(Number.isInteger(subtotal)).toBe(true);
  });

  it("un carrito vacío suma cero", () => {
    expect(cartCount([])).toBe(0);
    expect(cartSubtotal([])).toBe(0);
  });
});

describe("migrateCart", () => {
  it("conserva las líneas de la versión actual", () => {
    const state = { lines: [line()] };
    expect(migrateCart(state, CART_STORAGE_VERSION)).toEqual(state);
  });

  it("descarta carritos de versiones viejas en vez de adivinar la variante", () => {
    const v0 = { lines: [{ productId: 7, qty: 1 }] };
    expect(migrateCart(v0, 0)).toEqual({ lines: [] });
  });

  it("filtra líneas corruptas sin tirar todo el carrito", () => {
    const mixed = {
      lines: [
        line(),
        { variantId: "dos", qty: 1, name: "x", unitPricePyg: 1 },
        line({ variantId: 3, qty: 0 }),
        { variantId: 4, qty: 1, name: "sin precio" },
      ],
    };
    const migrated = migrateCart(mixed, CART_STORAGE_VERSION);
    expect(migrated.lines).toHaveLength(1);
    expect(migrated.lines[0]?.variantId).toBe(1);
  });

  it("aguanta basura en localStorage", () => {
    expect(migrateCart(null, CART_STORAGE_VERSION)).toEqual({ lines: [] });
    expect(migrateCart("no soy un carrito", CART_STORAGE_VERSION)).toEqual({ lines: [] });
    expect(migrateCart({ lines: "tampoco" }, CART_STORAGE_VERSION)).toEqual({ lines: [] });
  });
});
