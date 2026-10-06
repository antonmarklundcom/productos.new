import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { orders } from '../../src/db/schema';
import { countOrdersByStatus } from '../../src/domain/admin-orders';
import { parsePyDateInput, parsePyDateInputEnd } from '../../src/lib/py';
import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder } from '../helpers/factories';

/**
 * Números de los accesos rápidos por estado del listado de pedidos.
 *
 * Lo que se verifica es el criterio: los accesos cuentan "a dónde puedo ir
 * desde acá", así que ignoran el estado activo y respetan todo el resto de los
 * filtros.
 */
describe.skipIf(!hasTestDb)('countOrdersByStatus', () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('cuenta cada estado y devuelve el total', async () => {
    await createOrder({ status: 'esperando_verificacion' });
    await createOrder({ status: 'esperando_verificacion' });
    await createOrder({ status: 'pagado' });

    const counts = await countOrdersByStatus();

    expect(counts.byStatus.esperando_verificacion).toBe(2);
    expect(counts.byStatus.pagado).toBe(1);
    expect(counts.total).toBe(3);
  });

  it('los estados sin pedidos vienen en cero, no ausentes', async () => {
    await createOrder({ status: 'pagado' });

    const counts = await countOrdersByStatus();

    // Si faltara la clave, el acceso rápido mostraría "undefined" en vez de 0.
    expect(counts.byStatus.cancelado).toBe(0);
    expect(counts.byStatus.reembolsado).toBe(0);
  });

  it('ignora el estado activo: los accesos siguen mostrando a dónde ir', async () => {
    await createOrder({ status: 'pagado' });
    await createOrder({ status: 'enviado' });

    const counts = await countOrdersByStatus({ status: 'pagado' });

    // Con el estado aplicado, "enviado" daría cero y el acceso dejaría de
    // servir para navegar.
    expect(counts.byStatus.enviado).toBe(1);
    expect(counts.byStatus.pagado).toBe(1);
    expect(counts.total).toBe(2);
  });

  it('respeta el método de pago', async () => {
    await createOrder({ status: 'pagado', paymentMethod: 'transferencia' });
    await createOrder({ status: 'pagado', paymentMethod: 'contra_entrega' });

    const counts = await countOrdersByStatus({ paymentMethod: 'contra_entrega' });

    expect(counts.byStatus.pagado).toBe(1);
    expect(counts.total).toBe(1);
  });

  /** Fecha y teléfono se fijan después de crear: `createOrder` no los toma. */
  async function tweak(
    orderId: number,
    values: Partial<{ createdAt: Date; customerPhone: string }>,
  ): Promise<void> {
    await getTestDb().update(orders).set(values).where(eq(orders.id, orderId));
  }

  it('respeta el rango de fechas', async () => {
    const viejo = await createOrder({ status: 'pagado' });
    const nuevo = await createOrder({ status: 'pagado' });
    await tweak(viejo, { createdAt: new Date('2026-08-01T15:00:00Z') });
    await tweak(nuevo, { createdAt: new Date('2026-08-07T15:00:00Z') });

    const counts = await countOrdersByStatus({
      createdFrom: parsePyDateInput('2026-08-05') ?? undefined,
      createdTo: parsePyDateInputEnd('2026-08-07') ?? undefined,
    });

    expect(counts.total).toBe(1);
    expect(counts.byStatus.pagado).toBe(1);
  });

  it('respeta la búsqueda', async () => {
    const mio = await createOrder({ status: 'pagado' });
    await createOrder({ status: 'pagado' });
    await tweak(mio, { customerPhone: '+595981999999' });

    const counts = await countOrdersByStatus({ search: '0981 999 999' });

    expect(counts.total).toBe(1);
  });

  it('sin pedidos, todo en cero', async () => {
    const counts = await countOrdersByStatus();

    expect(counts.total).toBe(0);
    expect(counts.byStatus.pendiente_pago).toBe(0);
  });
});
