import { describe, expect, it } from "vitest";

import { buildProductFeed, escapeXml, type FeedProduct } from "@/lib/product-feed";

const origin = new URL("https://tienda.com.py");
const tienda = { nombre: "Tienda", descripcion: "Lo mejor" };

function producto(overrides: Partial<FeedProduct> = {}): FeedProduct {
  return {
    slug: "conjunto-encaje",
    name: "Conjunto de encaje",
    description: "Suave & liviano",
    brand: null,
    categoryName: "Conjuntos",
    images: ["https://res.cloudinary.com/x/a.jpg", "https://res.cloudinary.com/x/b.jpg"],
    variants: [{ sku: "CE-U", label: "Único", pricePyg: 150_000, compareAtPyg: null, available: 2 }],
    ...overrides,
  };
}

describe("buildProductFeed", () => {
  it("un ítem por variante, con lo que Google exige", () => {
    const xml = buildProductFeed({ origin, tienda, products: [producto()] });

    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    expect(xml).toContain("<g:id>CE-U</g:id>");
    expect(xml).toContain("<title>Conjunto de encaje</title>");
    expect(xml).toContain("<link>https://tienda.com.py/producto/conjunto-encaje</link>");
    expect(xml).toContain("<g:image_link>https://res.cloudinary.com/x/a.jpg</g:image_link>");
    expect(xml).toContain("<g:additional_image_link>https://res.cloudinary.com/x/b.jpg</g:additional_image_link>");
    expect(xml).toContain("<g:price>150000 PYG</g:price>");
    expect(xml).toContain("<g:availability>in_stock</g:availability>");
    expect(xml).toContain("<g:condition>new</g:condition>");
    // Sin marca no se inventa una.
    expect(xml).toContain("<g:identifier_exists>no</g:identifier_exists>");
    expect(xml).not.toContain("<g:item_group_id>");
  });

  it("variantes: mismo grupo, título con el talle, y el tachado como sale_price", () => {
    const xml = buildProductFeed({
      origin,
      tienda,
      products: [
        producto({
          brand: "Marca",
          variants: [
            { sku: "CE-S", label: "S", pricePyg: 120_000, compareAtPyg: 150_000, available: 0 },
            { sku: "CE-M", label: "M", pricePyg: 150_000, compareAtPyg: null, available: 1 },
          ],
        }),
      ],
    });

    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml.match(/<g:item_group_id>conjunto-encaje<\/g:item_group_id>/g)).toHaveLength(2);
    expect(xml).toContain("<title>Conjunto de encaje — S</title>");
    expect(xml).toContain("<g:price>150000 PYG</g:price><g:sale_price>120000 PYG</g:sale_price>");
    expect(xml).toContain("<g:availability>out_of_stock</g:availability>");
    expect(xml).toContain("<g:brand>Marca</g:brand>");
  });

  it("sin foto no hay ítem: Google lo rechazaría entero", () => {
    const xml = buildProductFeed({ origin, tienda, products: [producto({ images: [] })] });
    expect(xml).not.toContain("<item>");
  });

  it("escapa el texto del comercio", () => {
    const xml = buildProductFeed({ origin, tienda, products: [producto()] });
    expect(xml).toContain("<description>Suave &amp; liviano</description>");
    expect(escapeXml('<a href="x">\u0001')).toBe("&lt;a href=&quot;x&quot;&gt;");
  });
});
