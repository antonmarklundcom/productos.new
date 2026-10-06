import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { products } from '@/db/schema';
import { getCatalog, getFeaturedProducts } from '@/db/queries';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createCategory, createProduct, createVariant } from '../helpers/factories';

/**
 * La vitrina de la home (O7, plan-operacion §5.3 E).
 *
 * Lo que fija este archivo es la promesa de compatibilidad: **una tienda que
 * sincroniza la migración `0012` no ve moverse su portada**. La feature se
 * enciende sola el día que el dueño marca el primer producto, y hasta entonces
 * no existe.
 */

async function publicado(categoryId?: number): Promise<number> {
  const productId = await createProduct(categoryId);
  await createVariant({ onHand: 5, productId });
  return productId;
}

describe.skipIf(!hasTestDb)('getFeaturedProducts', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('sin ningún destacado devuelve exactamente lo que la home muestra hoy', async () => {
    const categoryId = await createCategory();
    for (let i = 0; i < 3; i += 1) await publicado(categoryId);

    const home = await getCatalog({ limit: 8 });
    const vitrina = await getFeaturedProducts(8);

    // Mismos productos y **en el mismo orden**: el orden también es parte de
    // la portada que no se puede mover.
    expect(vitrina.map((p) => p.id)).toEqual(home.map((p) => p.id));
    expect(vitrina.length).toBe(3);
  });

  it('con destacados devuelve sólo ésos', async () => {
    const categoryId = await createCategory();
    const uno = await publicado(categoryId);
    await publicado(categoryId);
    const tres = await publicado(categoryId);

    await getTestDb()
      .update(products)
      .set({ isFeatured: true })
      .where(inArray(products.id, [uno, tres]));

    const vitrina = await getFeaturedProducts(8);
    expect(new Set(vitrina.map((p) => p.id))).toEqual(new Set([uno, tres]));
  });

  it('un destacado despublicado no aparece', async () => {
    // `PUBLISHED()` manda: marcar destacado no publica nada. Si no fuera así,
    // la casilla de "destacado" sería una segunda forma de publicar, escondida.
    const categoryId = await createCategory();
    const visible = await publicado(categoryId);
    const escondido = await publicado(categoryId);

    const db = getTestDb();
    await db
      .update(products)
      .set({ isFeatured: true })
      .where(inArray(products.id, [visible, escondido]));
    await db.update(products).set({ isActive: false }).where(eq(products.id, escondido));

    expect((await getFeaturedProducts(8)).map((p) => p.id)).toEqual([visible]);
  });

  it('respeta el límite', async () => {
    const categoryId = await createCategory();
    const ids: number[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await publicado(categoryId));
    await getTestDb().update(products).set({ isFeatured: true }).where(inArray(products.id, ids));

    expect(await getFeaturedProducts(2)).toHaveLength(2);
  });

  it('sin catálogo devuelve una lista vacía y no explota', async () => {
    expect(await getFeaturedProducts(8)).toEqual([]);
  });
});
