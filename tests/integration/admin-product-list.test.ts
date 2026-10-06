import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { productImages, products, variants } from '../../src/db/schema';
import { listAdminProducts } from '../../src/domain/admin-products';
import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createCategory } from '../helpers/factories';

/**
 * Listado de productos del panel (`/admin/productos`).
 *
 * Lo que se verifica es lo que el dueño usa para trabajar: la foto que ve en
 * cada fila, el filtro por categoría y los dos órdenes que sirven para algo —
 * "qué se me está por acabar" y "cuánto sale".
 */
describe.skipIf(!hasTestDb)('listAdminProducts', () => {
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
    const slug = `prod-${randomBytes(4).toString('hex')}`;
    await db.insert(products).values({
      slug,
      name: options.name,
      categoryId: options.categoryId,
      ivaRate: 10,
      publishedAt: new Date(),
    });
    const row = (await db.select().from(products).where(eq(products.slug, slug)).limit(1))[0];
    if (!row) throw new Error('no pude crear el producto');

    for (const variant of options.variants ?? []) {
      await db.insert(variants).values({
        productId: row.id,
        sku: `SKU-${randomBytes(4).toString('hex').toUpperCase()}`,
        label: 'Único',
        pricePyg: variant.pricePyg,
        onHand: variant.onHand,
      });
    }
    return row.id;
  }

  async function addImage(productId: number, cloudinaryId: string, position: number): Promise<void> {
    await getTestDb()
      .insert(productImages)
      .values({ productId, cloudinaryId, alt: `alt de ${cloudinaryId}`, position });
  }

  it('trae la primera foto del producto, no una cualquiera', async () => {
    const categoryId = await createCategory();
    const id = await makeProduct({
      name: 'Corpiño',
      categoryId,
      variants: [{ pricePyg: 100_000, onHand: 5 }],
    });
    // Cargadas al revés a propósito: manda `position`, no el orden de alta.
    await addImage(id, 'productos/segunda', 1);
    await addImage(id, 'productos/primera', 0);

    const [row] = (await listAdminProducts()).rows;

    expect(row?.imageCloudinaryId).toBe('productos/primera');
    expect(row?.imageAlt).toBe('alt de productos/primera');
  });

  it('un producto sin fotos viene en null y con el slug de su categoría', async () => {
    // El listado usa el slug para elegir la ilustración placeholder.
    const categoryId = await createCategory('corpinos');
    await makeProduct({ name: 'Sin foto', categoryId, variants: [{ pricePyg: 90_000, onHand: 2 }] });

    const [row] = (await listAdminProducts()).rows;

    expect(row?.imageCloudinaryId).toBeNull();
    expect(row?.categorySlug).toBe('corpinos');
  });

  it('las fotos no multiplican las variantes contadas', async () => {
    // Con JOIN en vez de subconsulta, tres fotos triplicarían el COUNT y el
    // SUM: el dueño vería 6 variantes y 30 en stock donde hay 2 y 10.
    const categoryId = await createCategory();
    const id = await makeProduct({
      name: 'Con muchas fotos',
      categoryId,
      variants: [
        { pricePyg: 100_000, onHand: 4 },
        { pricePyg: 120_000, onHand: 6 },
      ],
    });
    for (const [index, name] of ['a', 'b', 'c'].entries()) await addImage(id, name, index);

    const [row] = (await listAdminProducts()).rows;

    expect(row?.variantCount).toBe(2);
    expect(row?.onHand).toBe(10);
    expect(row?.minPricePyg).toBe(100_000);
  });

  it('filtra por categoría', async () => {
    const corpinos = await createCategory('corpinos');
    const medias = await createCategory('medias');
    await makeProduct({ name: 'Corpiño', categoryId: corpinos });
    await makeProduct({ name: 'Media', categoryId: medias });

    const page = await listAdminProducts({ categoryId: medias });

    expect(page.total).toBe(1);
    expect(page.rows.map((row) => row.name)).toEqual(['Media']);
  });

  it('la categoría y la búsqueda se combinan', async () => {
    const corpinos = await createCategory('corpinos');
    const medias = await createCategory('medias');
    await makeProduct({ name: 'Encaje negro', categoryId: corpinos });
    await makeProduct({ name: 'Encaje negro', categoryId: medias });

    const page = await listAdminProducts({ search: 'encaje', categoryId: corpinos });

    expect(page.total).toBe(1);
    expect(page.rows[0]?.categorySlug).toBe('corpinos');
  });

  it('ordena por stock ascendente: primero lo que se está por acabar', async () => {
    const categoryId = await createCategory();
    await makeProduct({ name: 'Sobra', categoryId, variants: [{ pricePyg: 10_000, onHand: 40 }] });
    await makeProduct({ name: 'Justo', categoryId, variants: [{ pricePyg: 10_000, onHand: 1 }] });
    await makeProduct({ name: 'Medio', categoryId, variants: [{ pricePyg: 10_000, onHand: 9 }] });

    const page = await listAdminProducts({ sort: 'stock' });

    expect(page.rows.map((row) => row.name)).toEqual(['Justo', 'Medio', 'Sobra']);
  });

  it('el stock ordenado es la suma de las variantes, no la de una', async () => {
    const categoryId = await createCategory();
    await makeProduct({
      name: 'Dos variantes flacas',
      categoryId,
      variants: [
        { pricePyg: 10_000, onHand: 3 },
        { pricePyg: 10_000, onHand: 3 },
      ],
    });
    await makeProduct({ name: 'Una gorda', categoryId, variants: [{ pricePyg: 10_000, onHand: 5 }] });

    const page = await listAdminProducts({ sort: 'stock' });

    expect(page.rows.map((row) => row.name)).toEqual(['Una gorda', 'Dos variantes flacas']);
  });

  it('ordena por precio en las dos direcciones', async () => {
    const categoryId = await createCategory();
    await makeProduct({ name: 'Caro', categoryId, variants: [{ pricePyg: 300_000, onHand: 1 }] });
    await makeProduct({ name: 'Barato', categoryId, variants: [{ pricePyg: 50_000, onHand: 1 }] });
    await makeProduct({ name: 'Medio', categoryId, variants: [{ pricePyg: 150_000, onHand: 1 }] });

    const asc = await listAdminProducts({ sort: 'precio-asc' });
    expect(asc.rows.map((row) => row.name)).toEqual(['Barato', 'Medio', 'Caro']);

    const desc = await listAdminProducts({ sort: 'precio-desc' });
    expect(desc.rows.map((row) => row.name)).toEqual(['Caro', 'Medio', 'Barato']);
  });

  it('el producto sin precio queda último en las dos direcciones', async () => {
    // Sin variantes MIN(price) es NULL, y NULL no es "el más barato": es un
    // producto a medio cargar y va al final, no arriba de todo.
    const categoryId = await createCategory();
    await makeProduct({ name: 'Sin variantes', categoryId });
    await makeProduct({ name: 'Barato', categoryId, variants: [{ pricePyg: 50_000, onHand: 1 }] });

    for (const sort of ['precio-asc', 'precio-desc'] as const) {
      const page = await listAdminProducts({ sort });
      expect(page.rows.at(-1)?.name).toBe('Sin variantes');
    }
  });

  it('el orden por defecto sigue siendo lo editado hace poco', async () => {
    const categoryId = await createCategory();
    const viejo = await makeProduct({ name: 'Viejo', categoryId });
    await makeProduct({ name: 'Nuevo', categoryId });
    await getTestDb()
      .update(products)
      .set({ updatedAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(products.id, viejo));

    const page = await listAdminProducts();

    expect(page.rows.map((row) => row.name)).toEqual(['Nuevo', 'Viejo']);
  });
});
