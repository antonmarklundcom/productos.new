import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getBrands,
  getCategories,
  getCategoryBySlug,
  getCategoryProducts,
  getProductBySlug,
  getSitemapEntries,
  searchProducts,
} from "@/db/queries";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq } from "drizzle-orm";

import { reserveStock } from "@/domain/stock";

import {
  TEST_DATABASE_URL,
  closeTestDb,
  hasTestDb,
  resetTables,
} from "../helpers/db";
import { createOrder } from "../helpers/factories";

const run = promisify(execFile);

describe.skipIf(!hasTestDb)("queries del catálogo", () => {
  beforeAll(async () => {
    await resetTables();
    await run(
      process.execPath,
      [process.env.npm_execpath!, "exec", "tsx", "scripts/seed.ts"],
      {
        // Que no quede colgado para siempre si la DB no responde.
        timeout: 90_000,
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      }
    );
  }, 120_000);
  afterAll(closeTestDb);

  it("lista las categorías activas en orden", async () => {
    const categories = await getCategories();
    expect(categories.map((category) => category.slug)).toEqual([
      "electronica",
      "hogar-y-cocina",
      "moda",
      "deportes",
    ]);
  });

  it("pagina la categoría", async () => {
    const first = await getCategoryProducts({
      categorySlug: "moda",
      perPage: 4,
      page: 1,
    });
    expect(first.products).toHaveLength(4);
    expect(first.total).toBe(6);
    expect(first.totalPages).toBe(2);

    const second = await getCategoryProducts({
      categorySlug: "moda",
      perPage: 4,
      page: 2,
    });
    expect(second.products).toHaveLength(2);

    const overlap = first.products.filter((product) =>
      second.products.some((other) => other.id === product.id)
    );
    expect(overlap).toEqual([]);
  });

  it("ordena por precio mínimo de las variantes", async () => {
    const asc = await getCategoryProducts({
      categorySlug: "deportes",
      sort: "precio-asc",
      perPage: 60,
    });
    const prices = asc.products.map((product) =>
      Math.min(...product.variants.map((variant) => variant.pricePyg))
    );
    expect([...prices]).toEqual([...prices].sort((a, b) => a - b));

    const desc = await getCategoryProducts({
      categorySlug: "deportes",
      sort: "precio-desc",
      perPage: 60,
    });
    expect(desc.products[0]?.slug).toBe("bicicleta-rodado-29");
  });

  it("filtra por rango de precio y por marca", async () => {
    const baratos = await getCategoryProducts({
      categorySlug: "moda",
      maxPricePyg: 100000,
      perPage: 60,
    });
    for (const product of baratos.products) {
      expect(
        Math.min(...product.variants.map((v) => v.pricePyg))
      ).toBeLessThanOrEqual(100000);
    }

    const brands = await getBrands("moda");
    const basics = brands.find((facet) => facet.brand === "Basics PY");
    expect(basics).toBeDefined();

    const soloBasics = await getCategoryProducts({
      categorySlug: "moda",
      brand: "Basics PY",
      perPage: 60,
    });
    expect(
      soloBasics.products.every((product) => product.brand === "Basics PY")
    ).toBe(true);
    expect(soloBasics.total).toBe(soloBasics.products.length);

    // El conteo del filtro tiene que ser el mismo número que va a aparecer al
    // usarlo. Si se separan, "Basics PY (12)" lleva a una grilla de 3 y el
    // filtro deja de ser confiable para siempre.
    expect(basics?.total).toBe(soloBasics.total);
  });

  it("las marcas salen ordenadas y sin las de otras categorías", async () => {
    const moda = await getBrands("moda");
    const nombres = moda.map((facet) => facet.brand);

    // Con `localeCompare("es")` y no con el `.sort()` pelado: el orden lo hace
    // MySQL con `utf8mb4_general_ci`, donde la Ñ vale lo mismo que la N, así
    // que "Ñande Moda" va antes que "Totto". El `.sort()` de JS compara code
    // points y la manda al final — no es que la consulta esté desordenada, es
    // que son dos alfabetos distintos.
    expect(nombres).toEqual(
      [...nombres].sort((a, b) => a.localeCompare(b, "es"))
    );
    expect(new Set(nombres).size).toBe(nombres.length);
    expect(moda.every((facet) => facet.total > 0)).toBe(true);

    const electronica = (await getBrands("electronica")).map(
      (facet) => facet.brand
    );
    expect(electronica).not.toContain("Basics PY");
  });

  it("trae la ficha del producto con sus variantes", async () => {
    const product = await getProductBySlug("auriculares-bluetooth-tws");
    expect(product).not.toBeNull();
    expect(product?.categorySlug).toBe("electronica");
    expect(product?.variants.map((variant) => variant.label).sort()).toEqual([
      "Blanco",
      "Negro",
    ]);
    expect(product?.variants[0]?.available).toBeGreaterThan(0);
  });

  it("un slug inexistente devuelve null, no explota", async () => {
    expect(await getProductBySlug("no-existe-este-producto")).toBeNull();
    expect(await getCategoryBySlug("tampoco-existe")).toBeNull();
  });

  it("la disponibilidad del listado descuenta reservas vigentes", async () => {
    const before = await getProductBySlug("power-bank-20000mah");
    const variant = before?.variants[0];
    expect(variant).toBeDefined();

    const orderId = await createOrder();
    await reserveStock(orderId, [{ variantId: variant!.id, qty: 4 }], {
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const after = await getProductBySlug("power-bank-20000mah");
    expect(after?.variants[0]?.available).toBe(variant!.available - 4);
  });

  it("busca por FULLTEXT y por prefijo", async () => {
    const exact = await searchProducts("auriculares");
    expect(exact.map((product) => product.slug)).toContain(
      "auriculares-bluetooth-tws"
    );

    const prefix = await searchProducts("auricu");
    expect(prefix.map((product) => product.slug)).toContain(
      "auriculares-bluetooth-tws"
    );
  });

  it("cae al LIKE con términos cortos que FULLTEXT ignora", async () => {
    // "jean" tiene 4 caracteres: entra justo, pero el fallback es lo que
    // salva a "gorra" y compañía si ft_min_word_len sube.
    const jeans = await searchProducts("jean");
    expect(jeans.map((product) => product.slug)).toContain("jean-slim-hombre");
  });

  it("no devuelve nada con términos vacíos o de una letra", async () => {
    expect(await searchProducts("")).toEqual([]);
    expect(await searchProducts("a")).toEqual([]);
    expect(await searchProducts("   ")).toEqual([]);
  });

  it("no rompe con caracteres especiales del modo booleano", async () => {
    await expect(searchProducts('remera +-><()~*"@')).resolves.toBeInstanceOf(
      Array
    );
  });

  /**
   * El sitemap le enseña al buscador qué existe. Un producto despublicado que
   * siga en el XML es una promesa de 404 —y peor, es publicar algo que el
   * comercio decidió esconder—, así que el filtro tiene que ser el mismo de la
   * vidriera y no una consulta paralela que se olvide de `published_at`.
   */
  it("el sitemap lista sólo lo que la vidriera muestra", async () => {
    const antes = await getSitemapEntries();
    expect(antes.categories.map((category) => category.slug)).toEqual([
      "electronica",
      "hogar-y-cocina",
      "moda",
      "deportes",
    ]);
    expect(antes.products.map((product) => product.slug)).toContain(
      "jean-slim-hombre"
    );

    await getDb()
      .update(products)
      .set({ publishedAt: null })
      .where(eq(products.slug, "jean-slim-hombre"));

    const despues = await getSitemapEntries();
    expect(despues.products.map((product) => product.slug)).not.toContain(
      "jean-slim-hombre"
    );
    expect(despues.products).toHaveLength(antes.products.length - 1);

    await getDb()
      .update(products)
      .set({ publishedAt: new Date() })
      .where(eq(products.slug, "jean-slim-hombre"));
  });
});
