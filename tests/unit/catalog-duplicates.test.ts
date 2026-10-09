import { describe, expect, it } from "vitest";
import { catalogDuplicateWarnings } from "../../src/lib/catalog-duplicates";
const product = (slug: string, name: string, fotos: string[] = []) => ({
  slug,
  name,
  fotos,
  categoryName: "Hogar y cocina",
});
describe("catalog duplicate review", () => {
  it("flags one Dropi ID behind different names and categories", () => {
    expect(
      catalogDuplicateWarnings(
        [
          {
            ...product("a", "Herramienta"),
            dropiUrl:
              "https://app.dropi.com.py/dashboard/product-details/13535/a",
          },
        ],
        [
          {
            ...product("b", "Artículo"),
            categoryName: "Otra",
            dropiUrl:
              "https://app.dropi.com.py/dashboard/product-details/13535/b",
          },
        ]
      )
    ).toHaveLength(1);
  });
  it("flags different supplier listings, including singular/plural names", () => {
    expect(
      catalogDuplicateWarnings(
        [product("a", "Afilador de cuchillo")],
        [product("b", "Afilador de cuchillos")]
      )
    ).toHaveLength(1);
  });
  it("does not flag an update to the same product slug", () => {
    expect(
      catalogDuplicateWarnings(
        [product("a", "Afilador de cuchillos")],
        [product("a", "Afilador de cuchillos")]
      )
    ).toEqual([]);
  });
  it("detects incoming pairs once, and shared images with different titles", () => {
    expect(
      catalogDuplicateWarnings(
        [
          product("a", "Herramienta", ["https://example.com/x.jpg"]),
          product("b", "Organizador", ["https://example.com/x.jpg"]),
        ],
        []
      )
    ).toHaveLength(1);
  });
  it("does not confuse unrelated products or a single generic word", () => {
    expect(
      catalogDuplicateWarnings(
        [product("a", "Cuchillo de cocina")],
        [product("b", "Organizador de cocina")]
      )
    ).toEqual([]);
  });
});
