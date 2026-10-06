import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { REFUNDS_LEDGER_BACKFILL } from '@/db/backfills';
import { payments, refunds } from '@/db/schema';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder } from '../helpers/factories';

/**
 * El backfill del ledger de devoluciones que viaja en la migración 0012
 * (plan-operacion §2, "Backfill").
 *
 * Es la única excepción a "las migraciones no inventan el pasado", y existe
 * por un motivo medible: las invariantes que O7 le agrega a `pnpm reconcile`
 * —`refunded_pyg = Σ refunds` y `status = 'refunded' ⇔ refunded_pyg =
 * amount_pyg`— darían **rojas el primer día** en toda tienda que ya devolvió
 * plata alguna vez, porque esas devoluciones viejas no tienen fila en un
 * ledger que todavía no existía.
 *
 * El test no puede "correr la migración": el `global-setup` ya la aplicó
 * contra una base vacía, mucho antes de que haya un solo pago. Así que
 * siembra los datos que la tienda real tendría y corre **las mismas
 * sentencias** que están adentro del `.sql`, importadas de la constante que
 * el archivo de migración copia textualmente (hay un test unitario que
 * verifica esa copia).
 */

async function correrBackfill(): Promise<void> {
  for (const statement of REFUNDS_LEDGER_BACKFILL) {
    await getTestDb().execute(sql.raw(statement));
  }
}

async function crearPago(options: {
  status: 'paid' | 'refunded' | 'pending' | 'failed';
  amountPyg: number;
  providerRef: string;
}): Promise<number> {
  const db = getTestDb();
  const orderId = await createOrder({ status: 'pagado' });
  await db.insert(payments).values({
    orderId,
    provider: 'spi',
    providerRef: options.providerRef,
    amountPyg: options.amountPyg,
    status: options.status,
  });
  const [row] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.providerRef, options.providerRef))
    .limit(1);
  if (!row) throw new Error('no pude crear el pago');
  return row.id;
}

describe.skipIf(!hasTestDb)('backfill del ledger de devoluciones (0012)', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('un pago devuelto de antes del ledger queda con su fila y su acumulado', async () => {
    const paymentId = await crearPago({
      status: 'refunded',
      amountPyg: 250_000,
      providerRef: 'viejo-devuelto',
    });

    await correrBackfill();

    const [pago] = await getTestDb()
      .select({ refundedPyg: payments.refundedPyg, amountPyg: payments.amountPyg })
      .from(payments)
      .where(eq(payments.id, paymentId));
    expect(pago?.refundedPyg).toBe(250_000);
    expect(pago?.refundedPyg).toBe(pago?.amountPyg);

    const filas = await getTestDb()
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, paymentId));
    expect(filas).toHaveLength(1);
    expect(filas[0]?.amountPyg).toBe(250_000);
    // `migracion` y no el dueño actual: no sabemos quién autorizó esa
    // devolución, y ponerle un nombre sería inventar la atribución.
    expect(filas[0]?.actor).toBe('migracion');
    expect(filas[0]?.actorUserId).toBeNull();
    expect(filas[0]?.reason).toBe('devolución registrada antes del ledger');
  });

  it('no toca los pagos que no están devueltos', async () => {
    const cobrado = await crearPago({
      status: 'paid',
      amountPyg: 100_000,
      providerRef: 'cobrado',
    });
    const pendiente = await crearPago({
      status: 'pending',
      amountPyg: 100_000,
      providerRef: 'pendiente',
    });

    await correrBackfill();

    const filas = await getTestDb().select().from(refunds);
    expect(filas).toHaveLength(0);

    for (const id of [cobrado, pendiente]) {
      const [pago] = await getTestDb()
        .select({ refundedPyg: payments.refundedPyg })
        .from(payments)
        .where(eq(payments.id, id));
      expect(pago?.refundedPyg).toBe(0);
    }
  });

  it('corriéndolo dos veces no duplica nada', async () => {
    // `db:push`, `POST /api/setup/init` y un `migrate()` reintentado le pueden
    // pasar por encima más de una vez. Una segunda fila acá rompería justo la
    // invariante que el backfill existe para dejar verde.
    const paymentId = await crearPago({
      status: 'refunded',
      amountPyg: 90_000,
      providerRef: 'dos-veces',
    });

    await correrBackfill();
    await correrBackfill();

    const filas = await getTestDb().select().from(refunds).where(eq(refunds.paymentId, paymentId));
    expect(filas).toHaveLength(1);

    const [pago] = await getTestDb()
      .select({ refundedPyg: payments.refundedPyg })
      .from(payments)
      .where(eq(payments.id, paymentId));
    expect(pago?.refundedPyg).toBe(90_000);
  });

  it('fecha la devolución cuando el pago cambió, no hoy', async () => {
    // Fechar hoy una devolución de marzo mueve la plata de mes en cualquier
    // reporte por fecha, que es exactamente lo que el dueño va a mirar.
    const paymentId = await crearPago({
      status: 'refunded',
      amountPyg: 70_000,
      providerRef: 'de-marzo',
    });
    const cuando = new Date('2026-03-15T14:00:00Z');
    // SQL crudo: `payments.updated_at` es `ON UPDATE CURRENT_TIMESTAMP`, así
    // que un UPDATE normal la pisa con el ahora y el test no podría siquiera
    // simular un pago devuelto en marzo.
    await getTestDb().execute(
      sql`UPDATE \`payments\` SET \`updated_at\` = ${cuando} WHERE \`id\` = ${paymentId}`,
    );

    await correrBackfill();

    const [fila] = await getTestDb().select().from(refunds).where(eq(refunds.paymentId, paymentId));
    expect(fila?.createdAt.toISOString()).toBe(cuando.toISOString());
  });

  it('no le pisa el `updated_at` al pago que toca', async () => {
    // El modo de falla que este test fija: `payments.updated_at` es
    // `ON UPDATE CURRENT_TIMESTAMP`, así que el UPDATE del acumulado le pone
    // la fecha de la migración a todos los pagos devueltos de la historia si
    // no se la asigna explícitamente — y con ella se va el único dato que
    // dice cuándo se devolvió esa plata. Se descubrió cuando el test de
    // arriba dio la fecha de hoy.
    const paymentId = await crearPago({
      status: 'refunded',
      amountPyg: 40_000,
      providerRef: 'no-me-toques',
    });
    const cuando = new Date('2026-01-20T10:30:00Z');
    await getTestDb().execute(
      sql`UPDATE \`payments\` SET \`updated_at\` = ${cuando} WHERE \`id\` = ${paymentId}`,
    );

    await correrBackfill();

    const [pago] = await getTestDb()
      .select({ updatedAt: payments.updatedAt, refundedPyg: payments.refundedPyg })
      .from(payments)
      .where(eq(payments.id, paymentId));
    expect(pago?.refundedPyg).toBe(40_000);
    expect(pago?.updatedAt.toISOString()).toBe(cuando.toISOString());
  });
});
