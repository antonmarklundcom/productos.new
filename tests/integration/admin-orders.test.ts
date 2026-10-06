import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { orders } from '../../src/db/schema';
import { listOrders } from '../../src/domain/admin-orders';
import { parsePyDateInput, parsePyDateInputEnd } from '../../src/lib/py';
import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder } from '../helpers/factories';

/**
 * Listado del panel (PLAN.md 4.2): filtros, búsqueda y paginación, todo
 * server-side.
 */
describe.skipIf(!hasTestDb)('listOrders', () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  /** Fija número, teléfono, documento y fecha de un pedido ya creado. */
  async function tweak(
    orderId: number,
    values: Partial<{
      orderNumber: string;
      customerPhone: string;
      docNumber: string;
      customerName: string;
      createdAt: Date;
    }>,
  ): Promise<number> {
    await getTestDb().update(orders).set(values).where(eq(orders.id, orderId));
    return orderId;
  }

  it('filtra por estado', async () => {
    await createOrder({ status: 'pendiente_pago' });
    const esperando = await createOrder({ status: 'esperando_verificacion' });

    const result = await listOrders({ status: 'esperando_verificacion' });

    expect(result.total).toBe(1);
    expect(result.rows.map((row) => row.id)).toEqual([esperando]);
  });

  it('filtra por método de pago', async () => {
    await createOrder({ paymentMethod: 'transferencia' });
    const cod = await createOrder({ paymentMethod: 'contra_entrega' });

    const result = await listOrders({ paymentMethod: 'contra_entrega' });

    expect(result.rows.map((row) => row.id)).toEqual([cod]);
  });

  it('filtra por rango de fechas, con el borde superior inclusivo del día', async () => {
    const viejo = await tweak(await createOrder(), {
      createdAt: new Date('2026-08-01T15:00:00Z'),
    });
    // 03:00Z del 8 = 00:00 del 8 en Asunción (UTC−3): es el primer instante
    // del día siguiente, y no tiene que entrar en "hasta el 07/08".
    const justoDespues = await tweak(await createOrder(), {
      createdAt: new Date('2026-08-08T03:00:00Z'),
    });
    // 02:00Z del 8 = 23:00 del 7 en Asunción: sí entra.
    const ultimaHoraDel7 = await tweak(await createOrder(), {
      createdAt: new Date('2026-08-08T02:00:00Z'),
    });

    const result = await listOrders({
      createdFrom: parsePyDateInput('2026-08-05') ?? undefined,
      createdTo: parsePyDateInputEnd('2026-08-07') ?? undefined,
    });

    const ids = result.rows.map((row) => row.id);
    expect(ids).toContain(ultimaHoraDel7);
    expect(ids).not.toContain(viejo);
    expect(ids).not.toContain(justoDespues);
  });

  it('busca por número de pedido, con o sin el prefijo PY-', async () => {
    const target = await tweak(await createOrder(), { orderNumber: 'PY-000123' });
    await tweak(await createOrder(), { orderNumber: 'PY-000456' });

    for (const term of ['PY-000123', 'py-000123', '123']) {
      const result = await listOrders({ search: term });
      expect(result.rows.map((row) => row.id), `buscando "${term}"`).toEqual([target]);
    }
  });

  it('busca por WhatsApp aunque se escriba con otro formato', async () => {
    const target = await tweak(await createOrder(), { customerPhone: '+595981555444' });
    await tweak(await createOrder(), { customerPhone: '+595981000111' });

    // El dueño lo tipea como se lo dictaron; en la DB está normalizado.
    for (const term of ['0981 555 444', '0981555444', '+595981555444', '595981555444']) {
      const result = await listOrders({ search: term });
      expect(result.rows.map((row) => row.id), `buscando "${term}"`).toEqual([target]);
    }
  });

  it('busca por RUC con o sin guion', async () => {
    const target = await tweak(await createOrder(), { docNumber: '80012345-6' });
    await tweak(await createOrder(), { docNumber: '80099999-1' });

    for (const term of ['80012345-6', '800123456']) {
      const result = await listOrders({ search: term });
      expect(result.rows.map((row) => row.id), `buscando "${term}"`).toEqual([target]);
    }
  });

  it('cae al nombre del cliente cuando el término no es número ni documento', async () => {
    const target = await tweak(await createOrder(), { customerName: 'Rodrigo Benítez' });
    await tweak(await createOrder(), { customerName: 'Ana López' });

    const result = await listOrders({ search: 'Benítez' });
    expect(result.rows.map((row) => row.id)).toEqual([target]);
  });

  it('los comodines de LIKE se escapan: buscar "%" no lista todo', async () => {
    await createOrder();
    await createOrder();

    const result = await listOrders({ search: '%' });
    expect(result.total).toBe(0);
  });

  it('pagina del lado del servidor y ordena por fecha descendente', async () => {
    for (let i = 0; i < 7; i += 1) {
      await tweak(await createOrder(), {
        createdAt: new Date(Date.UTC(2026, 7, 1, 12, i)),
      });
    }

    const first = await listOrders({ perPage: 3, page: 1 });
    expect(first.rows).toHaveLength(3);
    expect(first.total).toBe(7);
    expect(first.totalPages).toBe(3);

    const second = await listOrders({ perPage: 3, page: 2 });
    expect(second.rows).toHaveLength(3);

    // Sin solapamiento entre páginas.
    const overlap = first.rows
      .map((row) => row.id)
      .filter((id) => second.rows.some((row) => row.id === id));
    expect(overlap).toEqual([]);

    // Más nuevo primero.
    const times = first.rows.map((row) => row.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('una página fuera de rango cae en la última en vez de quedar vacía', async () => {
    await createOrder();

    const result = await listOrders({ perPage: 10, page: 99 });

    expect(result.page).toBe(1);
    expect(result.rows).toHaveLength(1);
  });

  it('cuenta los comprobantes sin revisar sin duplicar filas del pedido', async () => {
    const db = getTestDb();
    const orderId = await createOrder({ status: 'esperando_verificacion' });

    const { receipts } = await import('../../src/db/schema');
    await db.insert(receipts).values([
      { orderId, cloudinaryId: 'a', mime: 'image/jpeg', bytes: 1, review: 'pending' },
      { orderId, cloudinaryId: 'b', mime: 'image/jpeg', bytes: 1, review: 'pending' },
      { orderId, cloudinaryId: 'c', mime: 'image/jpeg', bytes: 1, review: 'approved' },
    ]);

    const result = await listOrders({});

    // Un JOIN acá devolvería el pedido tres veces y rompería la paginación.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.pendingReceipts).toBe(2);
  });
});
