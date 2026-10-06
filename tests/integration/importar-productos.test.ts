import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { categories, products, variants } from "@/db/schema";

import {
  TEST_DATABASE_URL,
  closeTestDb,
  getTestDb,
  hasTestDb,
  resetTables,
} from "../helpers/db";

const run = promisify(execFile);

/**
 * `pnpm importar:productos` contra MySQL de verdad: ensayo que no escribe,
 * aplicar que escribe, idempotencia, el stock que no se pisa y el SKU ajeno
 * que frena todo. La validación pura ya está cubierta en
 * tests/unit/catalog-import.test.ts — acá se prueba lo que necesita base.
 */

const ENCABEZADO = "SKU;Producto;Categoría;Variante;Precio (₲);Stock";

async function importar(
  csv: string,
  ...flags: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  const dir = mkdtempSync(join(tmpdir(), "importar-"));
  const archivo = join(dir, "planilla.csv");
  writeFileSync(archivo, csv, "utf8");
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      [
        process.env.npm_execpath!,
        "exec",
        "tsx",
        "scripts/importar-productos.ts",
        archivo,
        ...flags,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
        timeout: 90_000,
      }
    );
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: e.code ?? 1,
    };
  }
}

const PLANILLA =
  `${ENCABEZADO}\n` +
  "AUR-1;Auriculares de prueba;Electrónica;Negro;285000;24\n" +
  "AUR-2;Auriculares de prueba;Electrónica;Blanco;285.000;18\n" +
  "YER-1;Yerba de prueba;Almacén;1 kg;38000;50\n";

describe.skipIf(!hasTestDb)("scripts/importar-productos.ts", () => {
  beforeAll(async () => {
    await resetTables();
  }, 120_000);
  afterAll(closeTestDb);

  it("el ensayo cuenta el plan y no escribe nada", async () => {
    const { stdout, code } = await importar(PLANILLA);

    expect(code).toBe(0);
    expect(stdout).toContain("2 productos");
    expect(stdout).toContain("3 variantes");
    expect(stdout).toContain("Ensayo");

    const db = getTestDb();
    expect(await db.select().from(products)).toHaveLength(0);
    expect(await db.select().from(categories)).toHaveLength(0);
  }, 120_000);

  it("--aplicar escribe productos, variantes y crea las categorías que faltan", async () => {
    const { stdout, code } = await importar(PLANILLA, "--aplicar");

    expect(code).toBe(0);
    expect(stdout).toContain("categorías creadas");

    const db = getTestDb();
    expect(await db.select().from(products)).toHaveLength(2);
    expect(await db.select().from(variants)).toHaveLength(3);
    const cats = await db.select().from(categories);
    expect(cats.map((c) => c.slug).sort()).toEqual(["almacen", "electronica"]);

    const yerba = (
      await db.select().from(variants).where(eq(variants.sku, "YER-1"))
    )[0]!;
    expect(yerba.pricePyg).toBe(38000);
    expect(yerba.onHand).toBe(50);
  }, 120_000);

  it("re-importar actualiza el precio sin duplicar y sin pisar el stock", async () => {
    const db = getTestDb();
    // La operación vendió: quedan 10. La planilla vieja dice 50.
    await db
      .update(variants)
      .set({ onHand: 10 })
      .where(eq(variants.sku, "YER-1"));

    const conPrecioNuevo = PLANILLA.replace("38000", "42000");
    const { code } = await importar(conPrecioNuevo, "--aplicar");
    expect(code).toBe(0);

    expect(await db.select().from(products)).toHaveLength(2);
    expect(await db.select().from(variants)).toHaveLength(3);
    const yerba = (
      await db.select().from(variants).where(eq(variants.sku, "YER-1"))
    )[0]!;
    expect(yerba.pricePyg).toBe(42000);
    expect(yerba.onHand).toBe(10);
  }, 120_000);

  it("--pisar-stock sí vuelve al stock de la planilla", async () => {
    const { code } = await importar(PLANILLA, "--aplicar", "--pisar-stock");
    expect(code).toBe(0);

    const db = getTestDb();
    const yerba = (
      await db.select().from(variants).where(eq(variants.sku, "YER-1"))
    )[0]!;
    expect(yerba.onHand).toBe(50);
  }, 120_000);

  it("un SKU que ya es de otro producto frena la corrida entera", async () => {
    const ajeno = `${ENCABEZADO}\nYER-1;Otro producto;Almacén;Único;99000;1\n`;
    const { stderr, code } = await importar(ajeno, "--aplicar");

    expect(code).not.toBe(0);
    expect(stderr).toContain("YER-1");
    expect(stderr).toContain("yerba-de-prueba");

    // Y de verdad no escribió: ni el producto nuevo ni el precio.
    const db = getTestDb();
    expect(await db.select().from(products)).toHaveLength(2);
    const yerba = (
      await db.select().from(variants).where(eq(variants.sku, "YER-1"))
    )[0]!;
    expect(yerba.pricePyg).toBe(38000);
  }, 120_000);

  it("una planilla con errores sale con código 1 y los lista con línea", async () => {
    const rota = `${ENCABEZADO}\nX-1;Algo;Hogar;Único;no-es-precio;1\n`;
    const { stderr, code } = await importar(rota, "--aplicar");

    expect(code).not.toBe(0);
    expect(stderr).toContain("Línea 2");
  }, 120_000);
});
