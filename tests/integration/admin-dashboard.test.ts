import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { orders } from '../../src/db/schema';
import { getDashboardSummary } from '../../src/domain/admin-dashboard';
import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder } from '../helpers/factories';

/**
 * Números del resumen (PLAN.md 4.7).
 *
 * Lo que se verifica es el criterio, no la aritmética: sólo entra en la caja
 * lo que ya se cobró, y el día se corta a medianoche de Asunción.
 */
describe.skipIf(!hasTestDb)('getDashboardSummary', () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function orderAt(options: {
    status: 'pendiente_pago' | 'esperando_verificacion' | 'pagado' | 'enviado' | 'cancelado';
    totalPyg: number;
    createdAt: Date;
  }): Promise<number> {
    const id = await createOrder({ status: options.status, totalPyg: options.totalPyg });
    await getTestDb().update(orders).set({ createdAt: options.createdAt }).where(eq(orders.id, id));
    return id;
  }

  // Mediodía de Asunción del 7/8/2026.
  const AHORA = new Date('2026-08-07T15:00:00Z');

  it('sólo suma los pedidos ya cobrados', async () => {
    await orderAt({ status: 'pagado', totalPyg: 100_000, createdAt: AHORA });
    await orderAt({ status: 'enviado', totalPyg: 50_000, createdAt: AHORA });
    // Estos no entran: todavía pueden vencer o ya se cayeron.
    await orderAt({ status: 'pendiente_pago', totalPyg: 999_000, createdAt: AHORA });
    await orderAt({ status: 'esperando_verificacion', totalPyg: 888_000, createdAt: AHORA });
    await orderAt({ status: 'cancelado', totalPyg: 777_000, createdAt: AHORA });

    const summary = await getDashboardSummary(AHORA);

    expect(summary.today.totalPyg).toBe(150_000);
    expect(summary.today.orders).toBe(2);
  });

  it('un pedido de las 21:00 de Asunción cuenta en ese día, no en el siguiente', async () => {
    // 2026-08-08T00:30Z = 21:30 del 7 en Asunción.
    const nocheDel7 = new Date('2026-08-08T00:30:00Z');
    await orderAt({ status: 'pagado', totalPyg: 70_000, createdAt: nocheDel7 });

    // Consultado a esa misma hora, tiene que estar en "hoy".
    const summary = await getDashboardSummary(nocheDel7);
    expect(summary.today.totalPyg).toBe(70_000);

    // Y consultado al día siguiente, ya no.
    const alDiaSiguiente = await getDashboardSummary(new Date('2026-08-08T15:00:00Z'));
    expect(alDiaSiguiente.today.totalPyg).toBe(0);
  });

  it('el mes no arrastra el mes anterior', async () => {
    await orderAt({ status: 'pagado', totalPyg: 200_000, createdAt: AHORA });
    await orderAt({
      status: 'pagado',
      totalPyg: 500_000,
      createdAt: new Date('2026-07-31T20:00:00Z'),
    });

    const summary = await getDashboardSummary(AHORA);

    expect(summary.month.totalPyg).toBe(200_000);
    expect(summary.month.orders).toBe(1);
  });

  it('cuenta lo que espera al dueño', async () => {
    await orderAt({ status: 'esperando_verificacion', totalPyg: 10_000, createdAt: AHORA });
    await orderAt({ status: 'esperando_verificacion', totalPyg: 20_000, createdAt: AHORA });
    await orderAt({ status: 'pendiente_pago', totalPyg: 30_000, createdAt: AHORA });

    const summary = await getDashboardSummary(AHORA);

    expect(summary.awaitingVerification).toBe(2);
    expect(summary.pendingPayment).toBe(1);
  });

  it('sin ventas devuelve cero y no null', async () => {
    const summary = await getDashboardSummary(AHORA);

    // SUM() sobre cero filas devuelve NULL en MySQL: si el COALESCE se cae,
    // el panel muestra "₲ NaN".
    expect(summary.today).toEqual({ totalPyg: 0, orders: 0 });
    expect(summary.month).toEqual({ totalPyg: 0, orders: 0 });
  });

  it('los montos grandes vuelven como enteros exactos', async () => {
    // La suma de un BIGINT vuelve como string desde mysql2: si no se
    // normaliza, "1500000" + "1500000" concatena en vez de sumar.
    await orderAt({ status: 'pagado', totalPyg: 1_500_000, createdAt: AHORA });
    await orderAt({ status: 'pagado', totalPyg: 1_500_000, createdAt: AHORA });

    const summary = await getDashboardSummary(AHORA);

    expect(summary.today.totalPyg).toBe(3_000_000);
    expect(Number.isInteger(summary.today.totalPyg)).toBe(true);
  });
});
