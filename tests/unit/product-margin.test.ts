import { describe, expect, it } from "vitest";
import { productMargin } from "../../src/lib/product-margin";
import { parseAdminProductPrice } from "../../src/lib/admin-product-sort";

describe("supplier cost and gross margin", () => {
  it("distinguishes 50% gross margin from 100% markup", () => {
    expect(productMargin(100_000, 50_000)).toEqual({
      spreadPyg: 50_000,
      marginPercent: 50,
      markupPercent: 100,
    });
  });
  it("keeps unknown costs unknown and avoids division by zero", () => {
    expect(productMargin(100_000, null)).toBeNull();
    expect(productMargin(100_000, 0)?.markupPercent).toBeNull();
    expect(productMargin(0, 20_000)?.marginPercent).toBeNull();
    expect(productMargin(50_000, 80_000)?.spreadPyg).toBe(-30_000);
  });
  it("accepts only safe whole-guarani price filters", () => {
    expect(parseAdminProductPrice("0")).toBe(0);
    expect(parseAdminProductPrice("100000")).toBe(100_000);
    for (const value of ["-1", "1.5", "1e4", "9007199254740992", "", undefined])
      expect(parseAdminProductPrice(value)).toBeUndefined();
  });
});
