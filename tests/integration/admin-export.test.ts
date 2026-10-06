import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { orders, products, variants } from '../../src/db/schema';
import { listOrdersForExport } from '../../src/domain/admin-orders';
import { listVariantsForExport } from '../../src/domain/admin-products';
import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createCategory, createOrder } from '../helpers/factories';

/**
 * Lo que baja el botón de "Descargar CSV".
 *
 * Lo que se verifica es la promesa del botón: baja **lo filtrado**, no la
 * página que se está viendo. Un export que trae veinte filas cuando hay
 * ochocientas es peor que no tener export.
 */
describe.skipIf(!hasTestDb)('export del panel', () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe('listOrdersForExport', () => {
    it('no se queda en la primera página del listado', async () => {
      for (let i = 0; i < 25; i += 1) await createOrder({ status: 'pagado' });

      // El listado pagina de a 20; el export tiene que traer los 25.
      expect(await listOrdersForExport()).toHaveLength(25);
    });

    it('respeta los filtros que están puestos en pantalla', async () => {
      await createOrder({ status: 'pagado' });
      await createOrder({ status: 'cancelado' });

      const rows = await listOrdersForExport({ status: 'pagado' });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('pagado');
    });

    it('respeta la búsqueda', async () => {
      const mio = await createOrder({ status: 'pagado' });
      await createOrder({ status: 'pagado' });
      await getTestDb()
        .update(orders)
        .set({ customerPhone: '+595981999999' })
        .where(eq(orders.id, mio));

      expect(await listOrdersForExport({ search: '0981 999 999' })).toHaveLength(1);
    });

    it('respeta el techo de filas', async () => {
      for (let i = 0; i < 5; i += 1) await createOrder({ status: 'pagado' });

      expect(await listOrdersForExport({}, 3)).toHaveLength(3);
    });

    it('trae los campos del archivo, con el total como entero', async () => {
      await createOrder({ status: 'pagado', totalPyg: 1_500_000 });

      const [row] = await listOrdersForExport();

      expect(row?.orderNumber).toMatch(/^PY-/);
      expect(row?.totalPyg).toBe(1_500_000);
      expect(Number.isInteger(row?.totalPyg)).toBe(true);
      expect(row?.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('listVariantsForExport', () => {
    async function makeProduct(options: {
      name: string;
      categoryId: number;
      variants: Array<{ pricePyg: number; onHand: number; label: string }>;
    }): Promise<void> {
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

      for (const [position, variant] of options.variants.entries()) {
        await db.insert(variants).values({
          productId: row.id,
          sku: `SKU-${randomBytes(4).toString('hex').toUpperCase()}`,
          label: variant.label,
          pricePyg: variant.pricePyg,
          onHand: variant.onHand,
          position,
        });
      }
    }

    it('baja una fila por variante y no una por producto', async () => {
      const categoryId = await createCategory('corpinos');
      await makeProduct({
        name: 'Corpiño',
        categoryId,
        variants: [
          { label: '90B / Negro', pricePyg: 145_000, onHand: 4 },
          { label: '95B / Negro', pricePyg: 145_000, onHand: 2 },
        ],
      });

      const rows = await listVariantsForExport();

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.label)).toEqual(['90B / Negro', '95B / Negro']);
      expect(rows[0]?.productName).toBe('Corpiño');
      expect(rows[0]?.categoryName).toBe('corpinos');
      expect(rows[0]?.pricePyg).toBe(145_000);
      expect(rows[0]?.onHand).toBe(4);
    });

    it('respeta el filtro de categoría', async () => {
      const corpinos = await createCategory('corpinos');
      const medias = await createCategory('medias');
      await makeProduct({
        name: 'Corpiño',
        categoryId: corpinos,
        variants: [{ label: '90B', pricePyg: 145_000, onHand: 1 }],
      });
      await makeProduct({
        name: 'Media',
        categoryId: medias,
        variants: [{ label: 'Única', pricePyg: 50_000, onHand: 1 }],
      });

      const rows = await listVariantsForExport({ categoryId: medias });

      expect(rows.map((row) => row.productName)).toEqual(['Media']);
    });

    it('respeta la búsqueda por nombre', async () => {
      const categoryId = await createCategory();
      await makeProduct({
        name: 'Corpiño de encaje',
        categoryId,
        variants: [{ label: '90B', pricePyg: 145_000, onHand: 1 }],
      });
      await makeProduct({
        name: 'Media larga',
        categoryId,
        variants: [{ label: 'Única', pricePyg: 50_000, onHand: 1 }],
      });

      const rows = await listVariantsForExport({ search: 'encaje' });

      expect(rows.map((row) => row.productName)).toEqual(['Corpiño de encaje']);
    });

    it('incluye lo despublicado: es la vista del dueño, no la vidriera', async () => {
      const categoryId = await createCategory();
      const db = getTestDb();
      await makeProduct({
        name: 'Borrador',
        categoryId,
        variants: [{ label: 'Única', pricePyg: 10_000, onHand: 3 }],
      });
      await db.update(products).set({ publishedAt: null, isActive: false });

      expect(await listVariantsForExport()).toHaveLength(1);
    });

    it('respeta el techo de filas', async () => {
      const categoryId = await createCategory();
      await makeProduct({
        name: 'Corpiño',
        categoryId,
        variants: [
          { label: 'A', pricePyg: 1_000, onHand: 1 },
          { label: 'B', pricePyg: 1_000, onHand: 1 },
          { label: 'C', pricePyg: 1_000, onHand: 1 },
        ],
      });

      expect(await listVariantsForExport({}, 2)).toHaveLength(2);
    });
  });
});
