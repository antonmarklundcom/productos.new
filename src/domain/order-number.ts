import { eq, sql } from 'drizzle-orm';

import { getDb } from '@/db';
import { counters } from '@/db/schema';

import type { Executor } from './executor';

export const ORDER_NUMBER_COUNTER = 'order_number';
const PREFIX = 'PY-';
const PAD = 6;

export function formatOrderNumber(value: number): string {
  return `${PREFIX}${String(value).padStart(PAD, '0')}`;
}

export function parseOrderNumber(orderNumber: string): number | null {
  const match = /^PY-(\d{4,})$/.exec(orderNumber.trim().toUpperCase());
  return match?.[1] ? Number(match[1]) : null;
}

/**
 * Próximo número de pedido: `"PY-000123"`.
 *
 * Sale de una fila contador bloqueada con `SELECT ... FOR UPDATE`, **nunca de
 * `COUNT(*)`**: con `COUNT(*)` dos checkouts simultáneos generan el mismo
 * número, y borrar un pedido reusaría uno ya entregado.
 *
 * Los huecos (transacción abortada) son aceptables; las colisiones no.
 */
export async function nextOrderNumber(executor?: Executor): Promise<string> {
  const run = async (tx: Executor): Promise<number> => {
    // Crea la fila la primera vez; si ya existe, no la toca.
    await tx
      .insert(counters)
      .values({ name: ORDER_NUMBER_COUNTER, value: 0 })
      .onDuplicateKeyUpdate({ set: { name: sql`${counters.name}` } });

    const locked = await tx
      .select({ value: counters.value })
      .from(counters)
      .where(eq(counters.name, ORDER_NUMBER_COUNTER))
      .for('update');

    const current = locked[0]?.value ?? 0;
    const next = current + 1;

    await tx
      .update(counters)
      .set({ value: next })
      .where(eq(counters.name, ORDER_NUMBER_COUNTER));

    return next;
  };

  // Si ya venimos adentro de una transacción, reusamos ese lock; si no,
  // abrimos una — el número tiene que quedar reservado antes de soltar la fila.
  const value = executor ? await run(executor) : await getDb().transaction(run);
  return formatOrderNumber(value);
}
