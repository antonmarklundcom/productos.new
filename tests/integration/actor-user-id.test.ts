import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { orderEvents, stockAdjustments, users } from '@/db/schema';
import { adjustStock } from '@/domain/admin-products';
import { expireOverdueOrders } from '@/domain/maintenance';
import { transitionOrder } from '@/domain/orders';
import { reviewReceipt } from '@/domain/receipt-review';
import { createUser } from '@/lib/auth';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder, createVariant } from '../helpers/factories';

/**
 * Atribución auditable (PLAN.md FASE 2, PR D).
 *
 * `actor` (el string `admin:due@tienda.py`) sigue siendo la verdad histórica.
 * Lo que agrega este PR es la FK, que es lo que permite **preguntar**: "todo
 * lo que hizo el usuario 4 en agosto" no se puede consultar contra un texto
 * sin adivinar cómo se escribía el email de esa persona en ese momento.
 *
 * Los dos lados se prueban acá: que lo que hace una persona quede atribuido, y
 * que lo que **no** la tiene quede NULL en vez de inventado.
 */

async function unUsuario(email = 'due@tienda.py') {
  const created = await createUser({ email, password: 'tienda2026segura', role: 'owner' });
  return created.id;
}

async function ultimoEvento(orderId: number) {
  const [row] = await getTestDb()
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(desc(orderEvents.id))
    .limit(1);
  return row;
}

describe.skipIf(!hasTestDb)('order_events.actor_user_id', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('una transición del panel queda con la FK y con el string', async () => {
    const userId = await unUsuario();
    const orderId = await createOrder({ status: 'pagado' });

    await transitionOrder(orderId, 'preparando', 'admin:due@tienda.py', null, {
      actorUserId: userId,
    });

    const event = await ultimoEvento(orderId);
    expect(event?.actorUserId).toBe(userId);
    // Las dos cosas conviven: el texto no se reemplaza por el id.
    expect(event?.actor).toBe('admin:due@tienda.py');
  });

  it('lo que no movió una persona queda NULL, no inventado', async () => {
    const orderId = await createOrder({ status: 'pagado' });

    // Sin `actorUserId`: es el caso del webhook de Pagopar y del comprobante
    // que sube la compradora.
    await transitionOrder(orderId, 'preparando', 'pagopar:webhook');

    const event = await ultimoEvento(orderId);
    expect(event?.actorUserId).toBeNull();
    expect(event?.actor).toBe('pagopar:webhook');
  });

  it('el cron que vence pedidos no se atribuye a nadie', async () => {
    const orderId = await createOrder({ status: 'pendiente_pago' });
    await getTestDb().execute(
      // Un pedido con la reserva vencida hace una hora.
      `UPDATE orders SET reserved_until = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ${orderId}`,
    );

    await expireOverdueOrders();

    const event = await ultimoEvento(orderId);
    expect(event?.toStatus).toBe('vencido');
    expect(event?.actor).toBe('cron');
    // Lo importante: nadie del panel queda con un vencimiento en su historial.
    expect(event?.actorUserId).toBeNull();
  });

  it('aprobar un comprobante atribuye a quien lo aprobó', async () => {
    const userId = await unUsuario();
    const orderId = await createOrder({ status: 'esperando_verificacion' });

    const db = getTestDb();
    await db.execute(
      `INSERT INTO receipts (order_id, cloudinary_id, mime, bytes) ` +
        `VALUES (${orderId}, 'comprobantes/x', 'image/jpeg', 1024)`,
    );
    const [receipt] = await db.execute(
      `SELECT id FROM receipts WHERE order_id = ${orderId} LIMIT 1`,
    );
    const receiptId = Number((receipt as unknown as Array<{ id: number }>)[0]?.id);

    await reviewReceipt({
      receiptId,
      decision: 'approved',
      note: null,
      reviewerId: userId,
      actor: 'admin:due@tienda.py',
    });

    const event = await ultimoEvento(orderId);
    expect(event?.toStatus).toBe('pagado');
    // La misma persona que quedó en `receipts.reviewed_by`.
    expect(event?.actorUserId).toBe(userId);
  });

  it('borrar al usuario no borra su historial: la FK queda en NULL', async () => {
    const userId = await unUsuario();
    const orderId = await createOrder({ status: 'pagado' });

    await transitionOrder(orderId, 'preparando', 'admin:due@tienda.py', null, {
      actorUserId: userId,
    });

    await getTestDb().delete(users).where(eq(users.id, userId));

    const event = await ultimoEvento(orderId);
    // El evento sigue existiendo —es append-only y sobrevive a la persona— y
    // lo que queda para saber quién fue es el `actor` de texto. Eso es
    // exactamente para lo que sigue existiendo esa columna.
    expect(event).toBeDefined();
    expect(event?.actorUserId).toBeNull();
    expect(event?.actor).toBe('admin:due@tienda.py');
  });
});

describe.skipIf(!hasTestDb)('stock_adjustments.actor_user_id', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('un ajuste del panel queda atribuido', async () => {
    const userId = await unUsuario();
    const variantId = await createVariant({ onHand: 10 });

    await adjustStock({
      variantId,
      delta: -2,
      reason: 'rotura en depósito',
      actor: 'admin:due@tienda.py',
      actorUserId: userId,
    });

    const [row] = await getTestDb()
      .select()
      .from(stockAdjustments)
      .where(eq(stockAdjustments.variantId, variantId));

    expect(row?.actorUserId).toBe(userId);
    expect(row?.actor).toBe('admin:due@tienda.py');
  });

  it('sin usuario detrás queda NULL', async () => {
    const variantId = await createVariant({ onHand: 10 });

    await adjustStock({
      variantId,
      delta: 5,
      reason: 'reposición del script de importación',
      actor: 'script:import',
    });

    const [row] = await getTestDb()
      .select()
      .from(stockAdjustments)
      .where(eq(stockAdjustments.variantId, variantId));

    expect(row?.actorUserId).toBeNull();
  });
});
