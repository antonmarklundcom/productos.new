import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getFeedProducts } from "@/db/queries";
import { productImages, products } from "@/db/schema";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createProduct, createVariant } from "../helpers/factories";

describe.skipIf(!hasTestDb)("getFeedProducts", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("lo publicado, con todas sus fotos en orden; lo que la vidriera no muestra, tampoco", async () => {
    const db = getTestDb();
    const publicado = await createProduct();
    await createVariant({ onHand: 3, productId: publicado });
    await db.insert(productImages).values([
      { productId: publicado, cloudinaryId: "b", position: 1 },
      { productId: publicado, cloudinaryId: "a", position: 0 },
    ]);

    const borrador = await createProduct();
    await createVariant({ onHand: 3, productId: borrador });
    await db.update(products).set({ publishedAt: null }).where(eq(products.id, borrador));

    const feed = await getFeedProducts();

    expect(feed.map((product) => product.id)).toEqual([publicado]);
    expect(feed[0]?.images.map((image) => image.cloudinaryId)).toEqual(["a", "b"]);
    expect(feed[0]?.variants[0]?.available).toBe(3);
    expect(feed[0]?.description).toBe("producto de prueba");
  });
});
