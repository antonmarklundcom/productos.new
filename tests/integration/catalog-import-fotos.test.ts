import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { productImages, products } from "@/db/schema";
import {
  applyCatalogFotos,
  buildCatalogImportPlan,
  ensureCatalogCategories,
} from "@/domain/catalog-import-plan";

import {
  upsertCatalogProducts,
  type CatalogProductUpsert,
} from "../../scripts/seed";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";

/**
 * La columna Fotos de la planilla (`pnpm importar:productos`) → Cloudinary.
 *
 * `parseCatalogo` y `buildCatalogImportPlan` ya están cubiertos sin base
 * (tests/unit/catalog-import.test.ts) y contra base (importar-productos.test.ts
 * en su forma CLI). Acá se prueba lo que necesita las dos cosas a la vez: la
 * cuenta de `fotosNuevas`, y `applyCatalogFotos` — sin Cloudinary configurado,
 * y con el uploader mockeado — sobre productos de verdad en la base de test.
 */

const ENCABEZADO = "SKU;Producto;Categoría;Variante;Precio (₲);Stock;Fotos";

function csvConFotos(fotos: string): string {
  return `${ENCABEZADO}\nFOT-1;Producto con fotos;Hogar;Único;100000;5;${fotos}\n`;
}

describe.skipIf(!hasTestDb)("applyCatalogFotos", () => {
  beforeEach(async () => {
    await resetTables();
    vi.unstubAllEnvs();
  }, 60_000);
  afterAll(closeTestDb);

  it("cuenta fotosNuevas en el plan y las omite (con un aviso claro) sin Cloudinary configurado", async () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    vi.stubEnv("CLOUDINARY_API_KEY", "");
    vi.stubEnv("CLOUDINARY_API_SECRET", "");

    const csv = csvConFotos("https://cdn.test/a1.jpg|https://cdn.test/a2.jpg");
    const plan = await buildCatalogImportPlan(csv);
    expect(plan.errores).toEqual([]);
    expect(plan.fotosNuevas).toBe(2);

    const categoriaPorSlug = await ensureCatalogCategories(plan);
    const db = getTestDb();
    const items: CatalogProductUpsert[] = plan.productos.map((producto) => ({
      slug: producto.slug,
      name: producto.name,
      description: producto.description,
      categoryId: [...categoriaPorSlug.values()][0]!,
      brand: producto.brand,
      ivaRate: producto.ivaRate,
      variants: producto.variants,
    }));
    await upsertCatalogProducts(items);

    // El catálogo se escribió igual: una foto omitida no frena el resto.
    expect(await db.select().from(products)).toHaveLength(1);

    const fotos = await applyCatalogFotos(plan.productos);
    expect(fotos).toEqual({
      fotosSubidas: 0,
      fotosOmitidas: 2,
      fotosFallidas: [],
    });
    expect(await db.select().from(productImages)).toHaveLength(0);
  }, 60_000);

  it("con el uploader mockeado, sube las fotos sólo a un producto sin ninguna y no duplica al reimportar", async () => {
    vi.resetModules();
    vi.doMock("@/lib/cloudinary", () => ({
      cloudinaryConfigured: () => true,
      carpetaProductos: () => "productos",
      cloudinary: {
        uploader: {
          upload: vi.fn(async (url: string) => ({
            public_id: `productos/mock-${url.split("/").pop()}`,
          })),
        },
      },
    }));

    const {
      buildCatalogImportPlan: build,
      ensureCatalogCategories: ensure,
      applyCatalogFotos: apply,
    } = await import("@/domain/catalog-import-plan");
    const { upsertCatalogProducts: upsert } =
      await import("../../scripts/seed");

    const csv = csvConFotos(
      "https://cdn.test/uno.jpg|https://cdn.test/dos.jpg"
    );
    const plan = await build(csv);
    expect(plan.errores).toEqual([]);
    expect(plan.fotosNuevas).toBe(2);

    const categoriaPorSlug = await ensure(plan);
    const items: CatalogProductUpsert[] = plan.productos.map((producto) => ({
      slug: producto.slug,
      name: producto.name,
      description: producto.description,
      categoryId: [...categoriaPorSlug.values()][0]!,
      brand: producto.brand,
      ivaRate: producto.ivaRate,
      variants: producto.variants,
    }));
    await upsert(items);

    const db = getTestDb();
    const producto = (
      await db
        .select()
        .from(products)
        .where(eq(products.slug, "producto-con-fotos"))
    )[0]!;

    const primeraSubida = await apply(plan.productos);
    expect(primeraSubida).toEqual({
      fotosSubidas: 2,
      fotosOmitidas: 0,
      fotosFallidas: [],
    });

    const imagenes = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, producto.id));
    expect(imagenes).toHaveLength(2);
    expect(imagenes.map((i) => i.alt).sort()).toEqual([
      "Producto con fotos",
      "Producto con fotos — foto 2",
    ]);

    // Reimportar la misma planilla: el producto ya tiene fotos, no se tocan.
    const plan2 = await build(csv);
    expect(plan2.fotosNuevas).toBe(0);
    const segundaSubida = await apply(plan2.productos);
    expect(segundaSubida).toEqual({
      fotosSubidas: 0,
      fotosOmitidas: 0,
      fotosFallidas: [],
    });

    const imagenesDespues = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, producto.id));
    expect(imagenesDespues).toHaveLength(2);

    vi.doUnmock("@/lib/cloudinary");
    vi.resetModules();
  }, 60_000);

  it("una foto que falla no frena a las demás ni al catálogo", async () => {
    vi.resetModules();
    vi.doMock("@/lib/cloudinary", () => ({
      cloudinaryConfigured: () => true,
      carpetaProductos: () => "productos",
      cloudinary: {
        uploader: {
          upload: vi.fn(async (url: string) => {
            if (url.includes("rota")) throw new Error("404 en el CDN");
            return { public_id: `productos/mock-${url.split("/").pop()}` };
          }),
        },
      },
    }));

    const {
      buildCatalogImportPlan: build,
      ensureCatalogCategories: ensure,
      applyCatalogFotos: apply,
    } = await import("@/domain/catalog-import-plan");
    const { upsertCatalogProducts: upsert } =
      await import("../../scripts/seed");

    const csv = csvConFotos(
      "https://cdn.test/rota.jpg|https://cdn.test/buena.jpg"
    );
    const plan = await build(csv);
    const categoriaPorSlug = await ensure(plan);
    const items: CatalogProductUpsert[] = plan.productos.map((producto) => ({
      slug: producto.slug,
      name: producto.name,
      description: producto.description,
      categoryId: [...categoriaPorSlug.values()][0]!,
      brand: producto.brand,
      ivaRate: producto.ivaRate,
      variants: producto.variants,
    }));
    await upsert(items);

    const resultado = await apply(plan.productos);
    expect(resultado.fotosSubidas).toBe(1);
    expect(resultado.fotosOmitidas).toBe(0);
    expect(resultado.fotosFallidas).toHaveLength(1);
    expect(resultado.fotosFallidas[0]!.url).toBe("https://cdn.test/rota.jpg");
    expect(resultado.fotosFallidas[0]!.motivo).toBe("Error");
    expect(resultado.fotosFallidas[0]!.motivo).not.toContain("404 en el CDN");

    vi.doUnmock("@/lib/cloudinary");
    vi.resetModules();
  }, 60_000);
});
