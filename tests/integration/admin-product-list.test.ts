import { randomBytes } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { productImages, products, variants } from "../../src/db/schema";
import {
  listAdminProducts,
  listVariantsForExport,
} from "../../src/domain/admin-products";
import { writeSupplierCost } from "../../src/domain/supplier-costs";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createCategory } from "../helpers/factories";

/**
 * Listado de productos del panel (`/admin/productos`).
 *
 * Lo que se verifica es lo que el dueño usa para trabajar: la foto que ve en
 * cada fila, el filtro por categoría y los dos órdenes que sirven para algo —
 * "qué se me está por acabar" y "cuánto sale".
 */
describe.skipIf(!hasTestDb)("listAdminProducts", () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function makeProduct(options: {
    name: string;
    categoryId: number;
    /** Una variante por precio; el stock se reparte entre ellas. */
    variants?: Array<{ pricePyg: number; onHand: number }>;
  }): Promise<number> {
    const db = getTestDb();
    const slug = `prod-${randomBytes(4).toString("hex")}`;
    await db.insert(products).values({
      slug,
      name: options.name,
      categoryId: options.categoryId,
      ivaRate: 10,
      publishedAt: new Date(),
    });
    const row = (
      await db.select().from(products).where(eq(products.slug, slug)).limit(1)
    )[0];
    if (!row) throw new Error("no pude crear el producto");

    for (const variant of options.variants ?? []) {
      await db.insert(variants).values({
        productId: row.id,
        sku: `SKU-${randomBytes(4).toString("hex").toUpperCase()}`,
        label: "Único",
        pricePyg: variant.pricePyg,
        onHand: variant.onHand,
      });
    }
    return row.id;
  }

  async function addImage(
    productId: number,
    cloudinaryId: string,
    position: number
  ): Promise<void> {
    await getTestDb()
      .insert(productImages)
      .values({
        productId,
        cloudinaryId,
        alt: `alt de ${cloudinaryId}`,
        position,
      });
  }

  it("trae la primera foto del producto, no una cualquiera", async () => {
    const categoryId = await createCategory();
    const id = await makeProduct({
      name: "Corpiño",
      categoryId,
      variants: [{ pricePyg: 100_000, onHand: 5 }],
    });
    // Cargadas al revés a propósito: manda `position`, no el orden de alta.
    await addImage(id, "productos/segunda", 1);
    await addImage(id, "productos/primera", 0);

    const [row] = (await listAdminProducts()).rows;

    expect(row?.imageCloudinaryId).toBe("productos/primera");
    expect(row?.imageAlt).toBe("alt de productos/primera");
  });

  it("un producto sin fotos viene en null y con el slug de su categoría", async () => {
    // El listado usa el slug para elegir la ilustración placeholder.
    const categoryId = await createCategory("corpinos");
    await makeProduct({
      name: "Sin foto",
      categoryId,
      variants: [{ pricePyg: 90_000, onHand: 2 }],
    });

    const [row] = (await listAdminProducts()).rows;

    expect(row?.imageCloudinaryId).toBeNull();
    expect(row?.categorySlug).toBe("corpinos");
  });

  it("las fotos no multiplican las variantes contadas", async () => {
    // Con JOIN en vez de subconsulta, tres fotos triplicarían el COUNT y el
    // SUM: el dueño vería 6 variantes y 30 en stock donde hay 2 y 10.
    const categoryId = await createCategory();
    const id = await makeProduct({
      name: "Con muchas fotos",
      categoryId,
      variants: [
        { pricePyg: 100_000, onHand: 4 },
        { pricePyg: 120_000, onHand: 6 },
      ],
    });
    for (const [index, name] of ["a", "b", "c"].entries())
      await addImage(id, name, index);

    const [row] = (await listAdminProducts()).rows;

    expect(row?.variantCount).toBe(2);
    expect(row?.onHand).toBe(10);
    expect(row?.minPricePyg).toBe(100_000);
  });

  it("filtra por categoría", async () => {
    const corpinos = await createCategory("corpinos");
    const medias = await createCategory("medias");
    await makeProduct({ name: "Corpiño", categoryId: corpinos });
    await makeProduct({ name: "Media", categoryId: medias });

    const page = await listAdminProducts({ categoryId: medias });

    expect(page.total).toBe(1);
    expect(page.rows.map((row) => row.name)).toEqual(["Media"]);
  });

  it("la categoría y la búsqueda se combinan", async () => {
    const corpinos = await createCategory("corpinos");
    const medias = await createCategory("medias");
    await makeProduct({ name: "Encaje negro", categoryId: corpinos });
    await makeProduct({ name: "Encaje negro", categoryId: medias });

    const page = await listAdminProducts({
      search: "encaje",
      categoryId: corpinos,
    });

    expect(page.total).toBe(1);
    expect(page.rows[0]?.categorySlug).toBe("corpinos");
  });

  it("ordena por stock ascendente: primero lo que se está por acabar", async () => {
    const categoryId = await createCategory();
    await makeProduct({
      name: "Sobra",
      categoryId,
      variants: [{ pricePyg: 10_000, onHand: 40 }],
    });
    await makeProduct({
      name: "Justo",
      categoryId,
      variants: [{ pricePyg: 10_000, onHand: 1 }],
    });
    await makeProduct({
      name: "Medio",
      categoryId,
      variants: [{ pricePyg: 10_000, onHand: 9 }],
    });

    const page = await listAdminProducts({ sort: "stock" });

    expect(page.rows.map((row) => row.name)).toEqual([
      "Justo",
      "Medio",
      "Sobra",
    ]);
  });

  it("el stock ordenado es la suma de las variantes, no la de una", async () => {
    const categoryId = await createCategory();
    await makeProduct({
      name: "Dos variantes flacas",
      categoryId,
      variants: [
        { pricePyg: 10_000, onHand: 3 },
        { pricePyg: 10_000, onHand: 3 },
      ],
    });
    await makeProduct({
      name: "Una gorda",
      categoryId,
      variants: [{ pricePyg: 10_000, onHand: 5 }],
    });

    const page = await listAdminProducts({ sort: "stock" });

    expect(page.rows.map((row) => row.name)).toEqual([
      "Una gorda",
      "Dos variantes flacas",
    ]);
  });

  it("ordena por precio en las dos direcciones", async () => {
    const categoryId = await createCategory();
    await makeProduct({
      name: "Caro",
      categoryId,
      variants: [{ pricePyg: 300_000, onHand: 1 }],
    });
    await makeProduct({
      name: "Barato",
      categoryId,
      variants: [{ pricePyg: 50_000, onHand: 1 }],
    });
    await makeProduct({
      name: "Medio",
      categoryId,
      variants: [{ pricePyg: 150_000, onHand: 1 }],
    });

    const asc = await listAdminProducts({ sort: "precio-asc" });
    expect(asc.rows.map((row) => row.name)).toEqual([
      "Barato",
      "Medio",
      "Caro",
    ]);

    const desc = await listAdminProducts({ sort: "precio-desc" });
    expect(desc.rows.map((row) => row.name)).toEqual([
      "Caro",
      "Medio",
      "Barato",
    ]);
  });

  it("el producto sin precio queda último en las dos direcciones", async () => {
    // Sin variantes MIN(price) es NULL, y NULL no es "el más barato": es un
    // producto a medio cargar y va al final, no arriba de todo.
    const categoryId = await createCategory();
    await makeProduct({ name: "Sin variantes", categoryId });
    await makeProduct({
      name: "Barato",
      categoryId,
      variants: [{ pricePyg: 50_000, onHand: 1 }],
    });

    for (const sort of ["precio-asc", "precio-desc"] as const) {
      const page = await listAdminProducts({ sort });
      expect(page.rows.at(-1)?.name).toBe("Sin variantes");
    }
  });

  it("el orden por defecto sigue siendo lo editado hace poco", async () => {
    const categoryId = await createCategory();
    const viejo = await makeProduct({ name: "Viejo", categoryId });
    await makeProduct({ name: "Nuevo", categoryId });
    await getTestDb()
      .update(products)
      .set({ updatedAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(products.id, viejo));

    const page = await listAdminProducts();

    expect(page.rows.map((row) => row.name)).toEqual(["Nuevo", "Viejo"]);
  });

  it("searches supplier IDs and SKUs and keeps combined publication/mode/price filters in the export", async () => {
    const categoryId = await createCategory();
    const id = await makeProduct({
      name: "Afilador",
      categoryId,
      variants: [{ pricePyg: 69_000, onHand: 0 }],
    });
    const other = await makeProduct({
      name: "Otro",
      categoryId,
      variants: [{ pricePyg: 90_000, onHand: 1 }],
    });
    await getTestDb()
      .update(products)
      .set({
        saleMode: "enquiry",
        dropiUrl:
          "https://app.dropi.com.py/dashboard/product-details/13535/afilador-de-cuchillos",
      })
      .where(eq(products.id, id));
    await getTestDb()
      .update(products)
      .set({ isActive: false })
      .where(eq(products.id, other));
    const sku = (
      await getTestDb()
        .select()
        .from(variants)
        .where(eq(variants.productId, id))
    )[0]!.sku;
    expect((await listAdminProducts({ search: sku })).rows[0]?.id).toBe(id);
    const filters = {
      search: "13535",
      status: "publicados" as const,
      saleMode: "enquiry" as const,
      minPricePyg: 60_000,
      maxPricePyg: 70_000,
    };
    expect(
      (await listAdminProducts(filters)).rows.map((row) => row.id)
    ).toEqual([id]);
    expect(
      (await listVariantsForExport(filters)).map((row) => row.sku)
    ).toEqual([sku]);
    expect(
      (await listAdminProducts({ status: "sin-publicar" })).rows.map(
        (row) => row.id
      )
    ).toEqual([other]);
  });

  it("sorts names and categories before pagination", async () => {
    const categoryId = await createCategory("alpha");
    for (const name of ["Zulu", "Alpha", "Medio"])
      await makeProduct({ name, categoryId });
    expect(
      (await listAdminProducts({ sort: "nombre-asc", perPage: 1, page: 2 }))
        .rows[0]?.name
    ).toBe("Medio");
    expect(
      (await listAdminProducts({ sort: "nombre-desc" })).rows.map(
        (row) => row.name
      )
    ).toEqual(["Zulu", "Medio", "Alpha"]);
  });

  it("pairs each price with its own cost, handles losses and excludes unknown/partial costs from margin filters", async () => {
    const categoryId = await createCategory();
    const paired = await makeProduct({
      name: "Dos variantes",
      categoryId,
      variants: [
        { pricePyg: 100_000, onHand: 0 },
        { pricePyg: 1_000_000, onHand: 0 },
      ],
    });
    const loss = await makeProduct({
      name: "Pérdida",
      categoryId,
      variants: [{ pricePyg: 50_000, onHand: 0 }],
    });
    const winner = await makeProduct({
      name: "Buen margen",
      categoryId,
      variants: [{ pricePyg: 100_000, onHand: 0 }],
    });
    const unknown = await makeProduct({
      name: "Sin costo",
      categoryId,
      variants: [{ pricePyg: 100_000, onHand: 0 }],
    });
    const partial = await makeProduct({
      name: "Costo parcial",
      categoryId,
      variants: [
        { pricePyg: 100_000, onHand: 0 },
        { pricePyg: 200_000, onHand: 0 },
      ],
    });
    for (const [id, costs] of [
      [paired, [20_000, 900_000]],
      [loss, [80_000]],
      [winner, [50_000]],
      [partial, [20_000]],
    ] as const) {
      const rows = await getTestDb()
        .select()
        .from(variants)
        .where(eq(variants.productId, id))
        .orderBy(variants.id);
      for (const [index, cost] of costs.entries())
        await writeSupplierCost(rows[index]!.id, {
          unitCostPyg: cost,
          source: "Proveedor de prueba",
          checkedAt: new Date(),
        });
      await getTestDb().execute(
        sql`UPDATE supplier_offers SET is_confirmed = TRUE, is_preferred = TRUE WHERE variant_id IN (${sql.join(
          rows.slice(0, costs.length).map((row) => sql`${row.id}`),
          sql`, `
        )})`
      );
    }
    const result = await listAdminProducts({ sort: "margen-desc" });
    expect(result.rows.find((row) => row.id === paired)?.minMarginPercent).toBe(
      10
    );
    expect(result.rows.find((row) => row.id === loss)?.minMarginPercent).toBe(
      -60
    );
    expect(
      result.rows.find((row) => row.id === unknown)?.minCostPyg
    ).toBeNull();
    expect(
      result.rows.find((row) => row.id === partial)?.minMarginPercent
    ).toBeNull();
    expect(
      (await listAdminProducts({ minMarginPercent: 50 })).rows.map(
        (row) => row.id
      )
    ).toEqual([winner]);
    expect(
      (await listVariantsForExport({ minMarginPercent: 50 }))[0]?.unitCostPyg
    ).toBe(50_000);
    expect(
      (await listAdminProducts({ costState: "faltantes" })).rows
        .map((row) => row.id)
        .sort()
    ).toEqual([unknown, partial].sort());
    expect((await listAdminProducts({ sort: "costo-desc" })).rows[0]?.id).toBe(
      paired
    );
  });
});
