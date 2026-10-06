import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { products, shippingZones } from "@/db/schema";
import {
  DEMO_PRODUCT_SLUGS,
  countActiveDemoProducts,
  countActiveShippingZones,
} from "@/domain/launch-checks";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createCategory } from "../helpers/factories";

describe.skipIf(!hasTestDb)("avisos de arranque del panel", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("cuenta los productos del seed que siguen a la venta, y sólo esos", async () => {
    const db = getTestDb();
    const categoryId = await createCategory();
    const [demo, otroDemo] = DEMO_PRODUCT_SLUGS;
    await db.insert(products).values([
      { slug: demo!, name: "Demo", categoryId, publishedAt: new Date() },
      { slug: otroDemo!, name: "Demo apagado", categoryId, isActive: false },
      { slug: "conjunto-encaje-real", name: "Real", categoryId, publishedAt: new Date() },
    ]);

    expect(await countActiveDemoProducts()).toBe(1);

    await db.update(products).set({ isActive: false }).where(eq(products.slug, demo!));
    expect(await countActiveDemoProducts()).toBe(0);
  });

  it("cuenta las zonas de envío activas: sin ninguna, el envío sale gratis", async () => {
    expect(await countActiveShippingZones()).toBe(0);

    await getTestDb().insert(shippingZones).values([
      { slug: "asuncion", name: "Asunción", cities: ["Asunción"], pricePyg: 25_000, position: 1 },
      { slug: "vieja", name: "Vieja", cities: [], pricePyg: 10_000, position: 2, isActive: false },
    ]);
    expect(await countActiveShippingZones()).toBe(1);
  });
});
