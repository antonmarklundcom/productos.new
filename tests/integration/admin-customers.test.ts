import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { orders, type OrderStatus } from '../../src/db/schema';
import { listCustomers } from '../../src/domain/admin-customers';
import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';

/**
 * Clientes derivados de los pedidos (`/admin/clientes`).
 *
 * No hay tabla de clientes: lo que se verifica es el criterio del
 * agrupamiento — un teléfono es un cliente, el nombre es el del último pedido
 * y "gastó" es sólo lo cobrado, igual que el resumen.
 */
describe.skipIf(!hasTestDb)('listCustomers', () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function orderFrom(options: {
    phone: string;
    name?: string;
    docNumber?: string | null;
    status?: OrderStatus;
    totalPyg?: number;
    createdAt?: Date;
  }): Promise<number> {
    const db = getTestDb();
    const orderNumber = `PY-T${randomBytes(4).toString('hex').toUpperCase()}`;
    await db.insert(orders).values({
      orderNumber,
      accessToken: randomBytes(32).toString('hex'),
      status: options.status ?? 'pagado',
      customerName: options.name ?? 'Cliente de Prueba',
      customerPhone: options.phone,
      docType: options.docNumber ? 'RUC' : 'NINGUNO',
      docNumber: options.docNumber ?? null,
      shipCity: 'Asunción',
      shipAddress: 'Av. Mcal. López 1234',
      paymentMethod: 'transferencia',
      subtotalPyg: options.totalPyg ?? 100_000,
      totalPyg: options.totalPyg ?? 100_000,
    });
    const row = (
      await db.select().from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1)
    )[0];
    if (!row) throw new Error('no pude crear el pedido');
    if (options.createdAt) {
      await db.update(orders).set({ createdAt: options.createdAt }).where(eq(orders.id, row.id));
    }
    return row.id;
  }

  const ANA = '+595981111111';
  const BETI = '+595982222222';

  it('agrupa los pedidos del mismo WhatsApp en un solo cliente', async () => {
    await orderFrom({ phone: ANA, totalPyg: 100_000 });
    await orderFrom({ phone: ANA, totalPyg: 250_000 });
    await orderFrom({ phone: BETI, totalPyg: 50_000 });

    const page = await listCustomers();

    expect(page.total).toBe(2);
    const ana = page.rows.find((row) => row.phone === ANA);
    expect(ana?.orders).toBe(2);
    expect(ana?.lifetimePyg).toBe(350_000);
  });

  it('sólo suma lo cobrado, con el mismo criterio que el resumen', async () => {
    await orderFrom({ phone: ANA, status: 'pagado', totalPyg: 100_000 });
    await orderFrom({ phone: ANA, status: 'entregado', totalPyg: 200_000 });
    // Estos cuentan como pedido pero no como plata: todavía pueden vencer o ya
    // se cayeron.
    await orderFrom({ phone: ANA, status: 'pendiente_pago', totalPyg: 999_000 });
    await orderFrom({ phone: ANA, status: 'cancelado', totalPyg: 777_000 });

    const [ana] = (await listCustomers()).rows;

    expect(ana?.orders).toBe(4);
    expect(ana?.paidOrders).toBe(2);
    expect(ana?.lifetimePyg).toBe(300_000);
  });

  it('el nombre y el documento son los del pedido más reciente', async () => {
    await orderFrom({
      phone: ANA,
      name: 'Ana Vieja',
      docNumber: '80012345-2',
      createdAt: new Date('2026-01-10T12:00:00Z'),
    });
    await orderFrom({
      phone: ANA,
      name: 'Ana Nueva',
      docNumber: '4123456-1',
      createdAt: new Date('2026-06-10T12:00:00Z'),
    });

    const [ana] = (await listCustomers()).rows;

    expect(ana?.name).toBe('Ana Nueva');
    expect(ana?.docNumber).toBe('4123456-1');
    expect(ana?.lastOrderAt.toISOString()).toBe('2026-06-10T12:00:00.000Z');
  });

  it('ordena por el último pedido, del más reciente al más viejo', async () => {
    await orderFrom({ phone: ANA, createdAt: new Date('2026-01-10T12:00:00Z') });
    await orderFrom({ phone: BETI, createdAt: new Date('2026-06-10T12:00:00Z') });

    const page = await listCustomers();

    expect(page.rows.map((row) => row.phone)).toEqual([BETI, ANA]);
  });

  it('sin pedidos cobrados el total es cero y no null', async () => {
    // SUM() sobre cero filas devuelve NULL en MySQL: si se cae el COALESCE, el
    // panel muestra "₲ NaN".
    await orderFrom({ phone: ANA, status: 'pendiente_pago', totalPyg: 100_000 });

    const [ana] = (await listCustomers()).rows;

    expect(ana?.lifetimePyg).toBe(0);
    expect(ana?.paidOrders).toBe(0);
  });

  it('los montos grandes vuelven como enteros exactos', async () => {
    // La suma de un BIGINT vuelve como string desde mysql2: sin normalizar,
    // "1500000" + "1500000" concatena en vez de sumar.
    await orderFrom({ phone: ANA, totalPyg: 1_500_000 });
    await orderFrom({ phone: ANA, totalPyg: 1_500_000 });

    const [ana] = (await listCustomers()).rows;

    expect(ana?.lifetimePyg).toBe(3_000_000);
    expect(Number.isInteger(ana?.lifetimePyg)).toBe(true);
  });

  describe('búsqueda', () => {
    it('encuentra por WhatsApp tipeado como lo tipea el dueño', async () => {
      await orderFrom({ phone: ANA });
      await orderFrom({ phone: BETI });

      const page = await listCustomers({ search: '0981 111 111' });

      expect(page.rows.map((row) => row.phone)).toEqual([ANA]);
      expect(page.total).toBe(1);
    });

    it('encuentra por nombre parcial', async () => {
      await orderFrom({ phone: ANA, name: 'Ana Gómez' });
      await orderFrom({ phone: BETI, name: 'Beatriz López' });

      const page = await listCustomers({ search: 'gómez' });

      expect(page.rows.map((row) => row.phone)).toEqual([ANA]);
    });

    it('encuentra por RUC con o sin guion', async () => {
      await orderFrom({ phone: ANA, docNumber: '80012345-2' });
      await orderFrom({ phone: BETI });

      for (const term of ['80012345-2', '800123452']) {
        const page = await listCustomers({ search: term });
        expect(page.rows.map((row) => row.phone)).toEqual([ANA]);
      }
    });

    it('buscar por nombre no recorta lo que gastó', async () => {
      // El filtro elige clientes, no pedidos: si filtrara pedidos, el total de
      // Ana sería sólo el del pedido cuyo nombre coincide.
      await orderFrom({
        phone: ANA,
        name: 'Ana Gómez',
        totalPyg: 100_000,
        createdAt: new Date('2026-01-10T12:00:00Z'),
      });
      await orderFrom({
        phone: ANA,
        name: 'Ana G. de Pérez',
        totalPyg: 200_000,
        createdAt: new Date('2026-06-10T12:00:00Z'),
      });

      const [ana] = (await listCustomers({ search: 'Gómez' })).rows;

      expect(ana?.orders).toBe(2);
      expect(ana?.lifetimePyg).toBe(300_000);
      expect(ana?.name).toBe('Ana G. de Pérez');
    });

    it('el % no es un comodín que liste todo', async () => {
      await orderFrom({ phone: ANA, name: 'Ana Gómez' });

      const page = await listCustomers({ search: '%' });

      expect(page.rows).toEqual([]);
    });
  });

  it('pagina sobre clientes, no sobre pedidos', async () => {
    // Tres clientes con dos pedidos cada uno: 6 pedidos, 3 clientes.
    for (const phone of [ANA, BETI, '+595983333333']) {
      await orderFrom({ phone });
      await orderFrom({ phone });
    }

    const page = await listCustomers({ perPage: 2 });

    expect(page.total).toBe(3);
    expect(page.totalPages).toBe(2);
    expect(page.rows).toHaveLength(2);

    const second = await listCustomers({ perPage: 2, page: 2 });
    expect(second.rows).toHaveLength(1);
  });

  it('una página fuera de rango cae en la última y no en el vacío', async () => {
    await orderFrom({ phone: ANA });

    const page = await listCustomers({ page: 9 });

    expect(page.page).toBe(1);
    expect(page.rows).toHaveLength(1);
  });
});
