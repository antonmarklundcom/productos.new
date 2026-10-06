import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { orderEvents, receipts, stockReservations, variants } from '../../src/db/schema';
import { reviewReceipt } from '../../src/domain/receipt-review';
import { reserveStock } from '../../src/domain/stock';
import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createAdminUser, createOrder, createVariant, getOnHand, getStatus } from '../helpers/factories';

/**
 * Revisión de comprobantes (PLAN.md 4.4 / 4.5).
 *
 * Lo que se prueba acá no es el botón: es que aprobar un comprobante mueva el
 * pedido **por la máquina de estados**, descuente stock una sola vez y deje
 * auditoría — todo en la misma transacción.
 */
describe.skipIf(!hasTestDb)('reviewReceipt', () => {
  beforeEach(async () => {
    await resetTables();
    reviewerId = await createAdminUser();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  /**
   * Quien revisa. Desde el PR D el id viaja a `order_events.actor_user_id`,
   * que es una FK contra `users`: un id inventado ya no es un número
   * cualquiera. Es además lo que pasa en producción, donde el id sale siempre
   * de una sesión abierta contra esa tabla.
   */
  let reviewerId: number;

  async function seedOrderWithReceipt(options: { onHand?: number; qty?: number } = {}) {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: options.onHand ?? 10 });
    const orderId = await createOrder({ status: 'esperando_verificacion' });

    await reserveStock(orderId, [{ variantId, qty: options.qty ?? 2 }], {
      expiresAt: new Date(Date.now() + 3600_000),
    });

    await db.insert(receipts).values({
      orderId,
      cloudinaryId: `comprobantes/test-${orderId}`,
      mime: 'image/jpeg',
      bytes: 1234,
      review: 'pending',
    });

    const row = (
      await db.select().from(receipts).where(eq(receipts.orderId, orderId)).limit(1)
    )[0];
    if (!row) throw new Error('no pude crear el comprobante');

    return { orderId, variantId, receiptId: row.id };
  }

  it('aprobar mueve el pedido a pagado y descuenta el stock', async () => {
    const { orderId, variantId, receiptId } = await seedOrderWithReceipt({ onHand: 10, qty: 2 });

    const result = await reviewReceipt({
      receiptId,
      decision: 'approved',
      reviewerId,
      actor: 'admin:due@tienda.py',
    });

    expect(result.changed).toBe(true);
    expect(await getStatus(orderId)).toBe('pagado');
    expect(await getOnHand(variantId)).toBe(8);

    const db = getTestDb();
    const reservation = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    expect(reservation.map((row) => row.state)).toEqual(['consumed']);
  });

  it('deja el comprobante marcado con quién y cuándo lo revisó', async () => {
    const { receiptId } = await seedOrderWithReceipt();

    await reviewReceipt({
      receiptId,
      decision: 'approved',
      reviewerId,
      actor: 'admin:due@tienda.py',
    });

    const db = getTestDb();
    const row = (await db.select().from(receipts).where(eq(receipts.id, receiptId)))[0];
    expect(row?.review).toBe('approved');
    expect(row?.reviewedBy).toBe(reviewerId);
    expect(row?.reviewedAt).toBeInstanceOf(Date);
  });

  it('escribe la fila de auditoría con el actor del admin', async () => {
    const { orderId, receiptId } = await seedOrderWithReceipt();

    await reviewReceipt({
      receiptId,
      decision: 'approved',
      reviewerId,
      actor: 'admin:due@tienda.py',
    });

    const db = getTestDb();
    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId));
    const last = events.at(-1);
    expect(last?.toStatus).toBe('pagado');
    expect(last?.actor).toBe('admin:due@tienda.py');
  });

  it('rechazar exige motivo y no toca el stock', async () => {
    const { orderId, variantId, receiptId } = await seedOrderWithReceipt({ onHand: 10, qty: 2 });

    await expect(
      reviewReceipt({ receiptId, decision: 'rejected', reviewerId, actor: 'admin:x' }),
    ).rejects.toThrow(/motivo/i);

    // Falló: ni el comprobante ni el pedido se movieron.
    expect(await getStatus(orderId)).toBe('esperando_verificacion');
    expect(await getOnHand(variantId)).toBe(10);

    const result = await reviewReceipt({
      receiptId,
      decision: 'rejected',
      note: 'el monto transferido no coincide',
      reviewerId,
      actor: 'admin:due@tienda.py',
    });

    expect(result.changed).toBe(true);
    expect(await getStatus(orderId)).toBe('rechazado');
    // El stock sigue reservado: el comprador puede subir otro comprobante.
    expect(await getOnHand(variantId)).toBe(10);
  });

  it('aprueba un segundo comprobante tras rechazar el primero y descuenta una sola vez', async () => {
    const db = getTestDb();
    const { orderId, variantId, receiptId } = await seedOrderWithReceipt({ onHand: 10, qty: 2 });
    const note = 'el monto transferido no coincide';
    await reviewReceipt({ receiptId, decision: 'rejected', note, reviewerId, actor: 'admin:x' });
    expect(await getStatus(orderId)).toBe('rechazado');
    expect(await getOnHand(variantId)).toBe(10);

    await db.insert(receipts).values({
      orderId,
      cloudinaryId: `comprobantes/test-${orderId}-reintento`,
      mime: 'image/jpeg',
      bytes: 999,
      review: 'pending',
    });
    const rows = await db.select().from(receipts).where(eq(receipts.orderId, orderId));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === receiptId)).toMatchObject({ review: 'rejected', note });
    const second = rows.find((row) => row.id !== receiptId);
    if (!second) throw new Error('no pude crear el segundo comprobante');
    expect(second.review).toBe('pending');

    // También debe poder cobrarse desde el panel mientras el pedido sigue rechazado.
    const result = await reviewReceipt({
      receiptId: second.id, decision: 'approved', reviewerId, actor: 'admin:x',
    });
    expect(result.changed).toBe(true);
    expect(await getStatus(orderId)).toBe('pagado');
    expect(await getOnHand(variantId)).toBe(8);
    const approved = (await db.select().from(receipts).where(eq(receipts.id, second.id)))[0];
    expect(approved?.review).toBe('approved');
    const reservations = await db.select().from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    expect(reservations.map((row) => row.state)).toEqual(['consumed']);
    await expect(reviewReceipt({
      receiptId: second.id, decision: 'approved', reviewerId, actor: 'admin:x',
    })).rejects.toThrow(/ya estaba aprobado/i);
    expect(await getOnHand(variantId)).toBe(8);
  });

  it('el motivo del rechazo queda guardado en el comprobante', async () => {
    const { receiptId } = await seedOrderWithReceipt();

    await reviewReceipt({
      receiptId,
      decision: 'rejected',
      note: 'la fecha del comprobante es de otro mes',
      reviewerId,
      actor: 'admin:due@tienda.py',
    });

    const db = getTestDb();
    const row = (await db.select().from(receipts).where(eq(receipts.id, receiptId)))[0];
    expect(row?.note).toBe('la fecha del comprobante es de otro mes');
  });

  it('un comprobante ya revisado no se puede revisar de nuevo', async () => {
    const { receiptId } = await seedOrderWithReceipt();

    await reviewReceipt({ receiptId, decision: 'approved', reviewerId, actor: 'admin:x' });

    await expect(
      reviewReceipt({ receiptId, decision: 'approved', reviewerId, actor: 'admin:x' }),
    ).rejects.toThrow(/ya estaba aprobado/i);
  });

  it('aprobar dos comprobantes del mismo pedido descuenta el stock una sola vez', async () => {
    const db = getTestDb();
    const { orderId, variantId, receiptId } = await seedOrderWithReceipt({ onHand: 10, qty: 3 });

    // Segundo comprobante del mismo pedido: pasa cuando el comprador sube dos
    // fotos de la misma transferencia.
    await db.insert(receipts).values({
      orderId,
      cloudinaryId: `comprobantes/test-${orderId}-b`,
      mime: 'image/jpeg',
      bytes: 999,
      review: 'pending',
    });
    const second = (
      await db.select().from(receipts).where(eq(receipts.orderId, orderId))
    ).find((row) => row.id !== receiptId);
    if (!second) throw new Error('no pude crear el segundo comprobante');

    await reviewReceipt({ receiptId, decision: 'approved', reviewerId, actor: 'admin:x' });
    expect(await getOnHand(variantId)).toBe(7);

    // El segundo se aprueba igual, pero el pedido ya está en `pagado`: la
    // transición es no-op y el stock no se toca dos veces.
    const result = await reviewReceipt({
      receiptId: second.id,
      decision: 'approved',
      reviewerId,
      actor: 'admin:x',
    });

    expect(result.changed).toBe(false);
    expect(await getOnHand(variantId)).toBe(7);
  });

  it('si la transición es inválida, el comprobante no queda marcado', async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 5 });
    // `enviado` no puede volver a `pagado` (ARCH.md §3).
    const orderId = await createOrder({ status: 'enviado' });

    await db.insert(receipts).values({
      orderId,
      cloudinaryId: `comprobantes/tarde-${orderId}`,
      mime: 'image/jpeg',
      bytes: 100,
      review: 'pending',
    });
    const receipt = (
      await db.select().from(receipts).where(eq(receipts.orderId, orderId)).limit(1)
    )[0];
    if (!receipt) throw new Error('no pude crear el comprobante');

    await expect(
      reviewReceipt({ receiptId: receipt.id, decision: 'approved', reviewerId, actor: 'admin:x' }),
    ).rejects.toThrow(/Transición inválida/i);

    // La transacción se deshizo entera: el comprobante sigue pendiente.
    const after = (await db.select().from(receipts).where(eq(receipts.id, receipt.id)))[0];
    expect(after?.review).toBe('pending');
    expect(await getStatus(orderId)).toBe('enviado');

    const stock = (await db.select().from(variants).where(eq(variants.id, variantId)))[0];
    expect(stock?.onHand).toBe(5);
  });
});
