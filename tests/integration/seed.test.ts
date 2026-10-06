import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getCatalog } from "@/db/queries";
import { categories, products, shippingZones, variants } from "@/db/schema";
import { assertGs } from "@/lib/money";

import {
  TEST_DATABASE_URL,
  closeTestDb,
  getTestDb,
  hasTestDb,
  resetTables,
} from "../helpers/db";
import { SEED_PRODUCTS } from "../../scripts/seed-data";

const run = promisify(execFile);

async function seed(): Promise<void> {
  await run(
    process.execPath,
    [process.env.npm_execpath!, "exec", "tsx", "scripts/seed.ts"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      // Que no quede colgado para siempre si la DB no responde.
      timeout: 90_000,
    }
  );
}

describe.skipIf(!hasTestDb)("scripts/seed.ts", () => {
  beforeAll(async () => {
    await resetTables();
    await seed();
  }, 120_000);
  afterAll(closeTestDb);

  it("siembra 4 categorías, 24 productos y sus variantes", async () => {
    const db = getTestDb();
    expect(await db.select().from(categories)).toHaveLength(4);
    expect(await db.select().from(products)).toHaveLength(SEED_PRODUCTS.length);
    expect(SEED_PRODUCTS.length).toBe(24);

    const variantRows = await db.select().from(variants);
    expect(variantRows.length).toBeGreaterThanOrEqual(SEED_PRODUCTS.length);
    for (const variant of variantRows) {
      expect(() => assertGs(variant.pricePyg, variant.sku)).not.toThrow();
      expect(variant.pricePyg).toBeGreaterThan(0);
    }
  });

  it("siembra zonas de envío con ciudades paraguayas", async () => {
    const db = getTestDb();
    const zones = await db.select().from(shippingZones);
    expect(zones).toHaveLength(4);

    const allCities = zones.flatMap((zone) => zone.cities);
    expect(allCities).toContain("Asunción");
    expect(allCities).toContain("Ciudad del Este");
    expect(allCities).toContain("Encarnación");
    for (const zone of zones) {
      expect(() => assertGs(zone.pricePyg, zone.slug)).not.toThrow();
    }
  });

  it("es idempotente: correrlo de nuevo no duplica nada", async () => {
    const db = getTestDb();
    const before = {
      categories: (await db.select().from(categories)).length,
      products: (await db.select().from(products)).length,
      variants: (await db.select().from(variants)).length,
      zones: (await db.select().from(shippingZones)).length,
    };

    await seed();

    expect({
      categories: (await db.select().from(categories)).length,
      products: (await db.select().from(products)).length,
      variants: (await db.select().from(variants)).length,
      zones: (await db.select().from(shippingZones)).length,
    }).toEqual(before);
  }, 120_000);

  it("el catálogo se lee como lo haría el Server Component", async () => {
    const catalog = await getCatalog({ limit: 100 });
    expect(catalog).toHaveLength(24);

    const first = catalog[0]!;
    expect(first.variants.length).toBeGreaterThan(0);
    expect(first.categoryName).toBeTruthy();
    expect(first.variants[0]!.available).toBeGreaterThan(0);

    const electronica = await getCatalog({ categorySlug: "electronica" });
    expect(electronica).toHaveLength(6);
  });
});
