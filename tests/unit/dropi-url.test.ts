import { describe, expect, it } from "vitest";
import { normalizeDropiUrl, parseCatalogo } from "@/domain/catalog-import";

const url = "https://app.dropi.com.py/dashboard/product-details/10067/cepillo-limpiador-con-dispenser-de-jabon";
const csv = (header: string, value: string) => `SKU,Producto,Categoría,Precio,${header}\nD1,Producto,Hogar,50000,${value}`;

describe("private Dropi supplier reference", () => {
  it("preserves omission and treats explicit blanks as clearing", () => {
    expect(normalizeDropiUrl(undefined)).toBeUndefined();
    expect(normalizeDropiUrl(" ")).toBeNull();
    expect(normalizeDropiUrl(null)).toBeNull();
    expect(normalizeDropiUrl(` ${url} `)).toBe(url);
    expect(parseCatalogo(csv("Marca", "")).productos[0]).not.toHaveProperty("dropiUrl");
    expect(parseCatalogo(csv("Dropi URL", "")).productos[0]?.dropiUrl).toBeNull();
  });
  it("preserves exact source links and optional trailing slash", () => {
    const links = [url, "https://app.dropi.com.py/dashboard/product-details/12875/picador-de-verduras-4en1", `${url}/`];
    for (const link of links) expect(normalizeDropiUrl(link)).toBe(link);
  });
  it.each(["Dropi URL", "product_url"])("imports %s", (header) => {
    const parsed = parseCatalogo(csv(header, url));
    expect(parsed.errores).toEqual([]);
    expect(parsed.productos[0]?.dropiUrl).toBe(url);
  });
  it.each([
    "http://app.dropi.com.py/dashboard/product-details/10067/cepillo-limpiador-con-dispenser-de-jabon",
    "https://app.dropi.com.py.evil.example/dashboard/product-details/10067/cepillo-limpiador-con-dispenser-de-jabon",
    "https://evil.example/dashboard/product-details/10067/cepillo-limpiador-con-dispenser-de-jabon",
    "https://user:pass@app.dropi.com.py/dashboard/product-details/10067/cepillo-limpiador-con-dispenser-de-jabon",
    "https://app.dropi.com.py/dashboard/product-details/10067/cepillo-limpiador-con-dispenser-de-jabon?token=secret",
    "https://app.dropi.com.py/dashboard",
    "https://app.dropi.com.py/dashboard/product-details/123/invalid slug",
    "javascript:alert(1)",
    "https://app.dropi.com.py/dashboard/search/123",
    "https://app.dropi.com.py/dashboard/product-details/0/producto",
    "https://app.dropi.com.py/dashboard/product-details/not-an-id/producto",
    "https://app.dropi.com.py/dashboard/product-details/123",
  ])("rejects unsupported link %s", (value) => {
    expect(() => normalizeDropiUrl(value)).toThrow();
    expect(parseCatalogo(csv("Dropi URL", value)).errores[0]).toContain("Línea 2");
  });
  it("rejects conflicting supplier references across variants", () => {
    const parsed = parseCatalogo(csv("Dropi URL", url) + "\nD2,Producto,Hogar,50000,https://app.dropi.com.py/dashboard/product-details/12875/picador-de-verduras-4en1");
    expect(parsed.errores[0]).toContain("Dropi URL");
  });
});
