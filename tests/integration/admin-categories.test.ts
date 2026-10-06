import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getCatalog,
  getCategories,
  getProductBySlug,
  getSitemapEntries,
  searchProducts,
} from '@/db/queries';
import { categories, products } from '@/db/schema';
import {
  AdminCategoryError,
  createCategory,
  listAdminCategories,
  moveCategory,
  setCategoryActive,
  updateCategory,
} from '@/domain/admin-categories';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createProduct, createVariant } from '../helpers/factories';

/**
 * ABM de categorías (PLAN.md FASE 2, PR J).
 *
 * Dos cosas que este test cuida y que no son obvias leyendo el ABM:
 *
 * - **Apagar una categoría apaga sus productos.** Es el cambio de comportamiento
 *   del PR: antes la categoría desaparecía del menú y devolvía 404 mientras sus
 *   productos seguían en la home, en el buscador y en el sitemap. Los casos de
 *   abajo recorren los cuatro lugares, porque arreglar `PUBLISHED()` y olvidarse
 *   del sitemap es exactamente el bug que quedaba.
 *
 * - **El orden se renumera, no se intercambia.** Se arranca a propósito de
 *   posiciones repetidas, que es como quedan dos tiendas clonadas del mismo
 *   seed.
 */

describe.skipIf(!hasTestDb)('alta y edición de categorías', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('el slug sale del nombre y se normaliza', async () => {
    const creada = await createCategory({ name: '  Ropa   de   Bebé ' });

    expect(creada.name).toBe('Ropa de Bebé');
    expect(creada.slug).toBe('ropa-de-bebe');
    expect(creada.isActive).toBe(true);
  });

  it('un slug escrito a mano también se normaliza', async () => {
    const creada = await createCategory({ name: 'Calzado', slug: '  Zapatos Y Botas  ' });
    expect(creada.slug).toBe('zapatos-y-botas');
  });

  it('rechaza un nombre del que no sale ninguna URL', async () => {
    await expect(createCategory({ name: '🙂🙂🙂' })).rejects.toThrow(AdminCategoryError);
  });

  it('no deja dos categorías con la misma URL', async () => {
    await createCategory({ name: 'Remeras' });
    await expect(createCategory({ name: 'Remeras' })).rejects.toThrow(AdminCategoryError);
  });

  it('renombrar sin tocar el slug deja la URL como estaba', async () => {
    const creada = await createCategory({ name: 'Remeras' });
    await updateCategory({ categoryId: creada.id, name: 'Remeras y buzos', slug: creada.slug });

    const [row] = await listAdminCategories();
    expect(row?.name).toBe('Remeras y buzos');
    expect(row?.slug).toBe('remeras');
  });

  it('no deja pisar el slug de otra categoría', async () => {
    await createCategory({ name: 'Remeras' });
    const otra = await createCategory({ name: 'Pantalones' });

    await expect(
      updateCategory({ categoryId: otra.id, name: 'Pantalones', slug: 'remeras' }),
    ).rejects.toThrow(AdminCategoryError);
  });

  it('cuenta los productos de cada categoría, publicados y totales', async () => {
    const cat = await createCategory({ name: 'Accesorios' });

    // Uno publicado y uno en borrador: el dueño necesita ver los dos números,
    // porque el que decide qué desaparece de la vidriera es el segundo.
    await createProduct(cat.id);
    const borrador = await createProduct(cat.id);
    await getTestDb()
      .update(products)
      .set({ publishedAt: null })
      .where(eq(products.id, borrador));

    const [row] = await listAdminCategories();
    expect(row?.productos).toBe(2);
    expect(row?.publicados).toBe(1);
  });

  it('una categoría recién creada aparece con cero productos', async () => {
    await createCategory({ name: 'Vacía' });
    const [row] = await listAdminCategories();
    expect(row?.productos).toBe(0);
    expect(row?.publicados).toBe(0);
  });
});

describe.skipIf(!hasTestDb)('desactivar una categoría la saca a ella y a sus productos', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  async function tiendaConUnProducto() {
    const cat = await createCategory({ name: 'Remeras' });
    const productId = await createProduct(cat.id);
    await createVariant({ onHand: 5, productId });

    const [row] = await getTestDb()
      .select({ slug: products.slug })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    return { categoryId: cat.id, productId, slug: row!.slug };
  }

  it('con la categoría activa, el producto se ve en los cinco lugares', async () => {
    const { slug } = await tiendaConUnProducto();

    expect(await getCatalog()).toHaveLength(1);
    expect(await getCategories()).toHaveLength(1);
    expect(await getProductBySlug(slug)).not.toBeNull();
    // 'producto de prueba' es la descripción que pone la factory.
    expect(await searchProducts('producto')).toHaveLength(1);

    const sitemap = await getSitemapEntries();
    expect(sitemap.categories).toHaveLength(1);
    expect(sitemap.products).toHaveLength(1);
  });

  it('apagada, no se ve en ninguno', async () => {
    const { categoryId, slug } = await tiendaConUnProducto();
    await setCategoryActive({ categoryId, isActive: false });

    expect(await getCatalog()).toEqual([]);
    expect(await getCategories()).toEqual([]);
    // La ficha suelta: sin esto, /producto/<slug> seguía sirviendo 200 con una
    // miga de pan que llevaba al 404 de su propia categoría.
    expect(await getProductBySlug(slug)).toBeNull();
    expect(await searchProducts('producto')).toEqual([]);

    const sitemap = await getSitemapEntries();
    expect(sitemap.categories).toEqual([]);
    // El que se olvidaba antes: el producto quedaba en el XML apuntando a una
    // ficha que ya no existe.
    expect(sitemap.products).toEqual([]);
  });

  it('reactivarla lo devuelve todo, sin tocar el producto', async () => {
    const { categoryId, slug } = await tiendaConUnProducto();
    await setCategoryActive({ categoryId, isActive: false });
    await setCategoryActive({ categoryId, isActive: true });

    expect(await getCatalog()).toHaveLength(1);
    expect(await getProductBySlug(slug)).not.toBeNull();
    expect((await getSitemapEntries()).products).toHaveLength(1);
  });

  it('desactivar una que no existe es un error prolijo', async () => {
    await expect(setCategoryActive({ categoryId: 9999, isActive: false })).rejects.toThrow(
      AdminCategoryError,
    );
  });
});

describe.skipIf(!hasTestDb)('orden del menú', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  async function tresCategorias() {
    const a = await createCategory({ name: 'Uno' });
    const b = await createCategory({ name: 'Dos' });
    const c = await createCategory({ name: 'Tres' });
    return [a.id, b.id, c.id];
  }

  const nombres = async () => (await listAdminCategories()).map((row) => row.name);

  it('las nuevas se agregan al final', async () => {
    await tresCategorias();
    expect(await nombres()).toEqual(['Uno', 'Dos', 'Tres']);
  });

  it('subir intercambia con la de arriba', async () => {
    const [, b] = await tresCategorias();
    await moveCategory({ categoryId: b!, direction: 'up' });
    expect(await nombres()).toEqual(['Dos', 'Uno', 'Tres']);
  });

  it('bajar intercambia con la de abajo', async () => {
    const [, b] = await tresCategorias();
    await moveCategory({ categoryId: b!, direction: 'down' });
    expect(await nombres()).toEqual(['Uno', 'Tres', 'Dos']);
  });

  it('subir la primera no hace nada y no explota', async () => {
    const [a] = await tresCategorias();
    await moveCategory({ categoryId: a!, direction: 'up' });
    expect(await nombres()).toEqual(['Uno', 'Dos', 'Tres']);
  });

  it('con posiciones repetidas igual ordena, y las deja limpias', async () => {
    // Así queda una tienda cuyo seed insertó todo en `position = 0`: sin el
    // renumerado, intercambiar posiciones no cambiaría nada nunca.
    const [a, b, c] = await tresCategorias();
    const db = getTestDb();
    for (const id of [a!, b!, c!]) {
      await db.update(categories).set({ position: 0 }).where(eq(categories.id, id));
    }

    await moveCategory({ categoryId: c!, direction: 'up' });

    const filas = await listAdminCategories();
    expect(filas.map((row) => row.position)).toEqual([0, 1, 2]);
    expect(filas.map((row) => row.name)).toEqual(['Uno', 'Tres', 'Dos']);
  });

  it('la vidriera respeta ese orden', async () => {
    const [a, b] = await tresCategorias();
    await moveCategory({ categoryId: b!, direction: 'up' });

    const menu = await getCategories();
    expect(menu.map((row) => row.name)).toEqual(['Dos', 'Uno', 'Tres']);
    expect(menu[1]?.id).toBe(a);
  });
});
