import { describe, expect, it } from "vitest";
import { catalogosRegistrados } from "@/i18n";
import { publicCatalogs } from "@/i18n/public-catalogs";
import { t, tPlural } from "@/i18n/client";

describe("storefront messages", () => {
  it("contains every public key and registered translation without admin/setup text", () => {
    const excluded =
      /^(?:panel\.|adminError\.|adminForm\.|setup\.|preflight\.|wa\.)/;
    for (const [lang, catalog] of Object.entries(catalogosRegistrados())) {
      expect(publicCatalogs[lang]).toEqual(
        Object.fromEntries(
          Object.entries(catalog).filter(([key]) => !excluded.test(key))
        )
      );
    }
    expect(Object.keys(publicCatalogs["es-PY"]!).length).toBeLessThan(
      Object.keys(catalogosRegistrados()["es-PY"]!).length / 2
    );
  });
  it("interpolates and handles singular/plural with the same contract", () => {
    expect(
      t("producto.consultaVariante", {
        producto: "Test",
        variante: "M",
        sku: "SKU",
      })
    ).toContain("Test");
    expect(tPlural("catalogo.productos", 2)).toContain("2");
  });
});
