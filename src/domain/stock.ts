import { and, eq, gt, inArray, sql } from 'drizzle-orm';

import { getDb } from '@/db';
import { withLockRetry } from '@/db/retry';
import { stockReservations, variants } from '@/db/schema';

import type { Executor } from './executor';

/** Cuánto dura la reserva según el medio de pago (ARCH.md §2 "Stock: holds"). */
export const RESERVATION_TTL_MINUTES = {
  transferencia: 24 * 60,
  // La plata entra en la puerta, días después del pedido; 24 h vencía pedidos con el paquete armado.
  contra_entrega: 7 * 24 * 60,
  tarjeta: 45,
} as const;

export class InsufficientStockError extends Error {
  constructor(
    readonly variantId: number,
    readonly requested: number,
    readonly available: number,
  ) {
    super(`Stock insuficiente para la variante ${variantId}: pedí ${requested}, hay ${available}`);
    this.name = 'InsufficientStockError';
  }
}

export type ReserveItem = { variantId: number; qty: number };

/** Suma de reservas vigentes (`held` y sin vencer) de una variante. */
async function heldQty(tx: Executor, variantId: number): Promise<number> {
  const rows = await tx
    .select({ held: sql<number>`COALESCE(SUM(${stockReservations.qty}), 0)` })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.variantId, variantId),
        eq(stockReservations.state, 'held'),
        gt(stockReservations.expiresAt, sql`NOW()`),
      ),
    );
  return Number(rows[0]?.held ?? 0);
}

/**
 * Igual que heldQty pero con lectura bloqueante, para usar adentro de la
 * transacción que reserva.
 *
 * Es la diferencia entre no vender de más y venderlo: en REPEATABLE READ, un
 * SELECT común lee del snapshot que la transacción tomó en su **primera**
 * lectura. Si antes hubo otras consultas —re-precio, envío, contador— ese
 * snapshot es anterior al commit del comprador rival, así que el
 * `SELECT ... FOR UPDATE` sobre la variante ve la fila al día pero la suma de
 * reservas no ve la reserva recién insertada, y los dos creen que queda una
 * unidad. Una lectura bloqueante ve siempre la última versión confirmada, y
 * de paso toma gap locks que frenan el insert del otro lado.
 */
async function heldQtyForUpdate(tx: Executor, variantId: number): Promise<number> {
  const rows = await tx
    .select({ qty: stockReservations.qty })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.variantId, variantId),
        eq(stockReservations.state, 'held'),
        gt(stockReservations.expiresAt, sql`NOW()`),
      ),
    )
    .for('update');

  return rows.reduce((total, row) => total + row.qty, 0);
}

/**
 * `disponible = on_hand − Σ(reservas held no vencidas)`.
 *
 * Se calcula en vivo: una reserva vencida deja de contar sola, así que un cron
 * caído nunca puede dejar stock varado.
 */
export async function getAvailability(variantId: number, executor?: Executor): Promise<number> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select({ onHand: variants.onHand })
    .from(variants)
    .where(eq(variants.id, variantId));

  const onHand = rows[0]?.onHand;
  if (onHand === undefined) return 0;

  return Math.max(0, onHand - (await heldQty(tx, variantId)));
}

/**
 * Reservas vigentes por variante, agrupadas.
 *
 * A propósito **no** es una subconsulta correlacionada: da lo mismo en dos
 * queries y evita las diferencias de correlación entre MySQL y MariaDB.
 */
export async function heldQtyMap(
  variantIds: readonly number[],
  executor?: Executor,
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (variantIds.length === 0) return result;

  const tx = executor ?? getDb();
  const rows = await tx
    .select({
      variantId: stockReservations.variantId,
      held: sql<number>`COALESCE(SUM(${stockReservations.qty}), 0)`,
    })
    .from(stockReservations)
    .where(
      and(
        inArray(stockReservations.variantId, [...variantIds]),
        eq(stockReservations.state, 'held'),
        gt(stockReservations.expiresAt, sql`NOW()`),
      ),
    )
    .groupBy(stockReservations.variantId);

  for (const row of rows) {
    result.set(row.variantId, Number(row.held));
  }
  return result;
}

/** Disponibilidad de varias variantes (grilla de catálogo). */
export async function getAvailabilityMap(
  variantIds: readonly number[],
  executor?: Executor,
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (variantIds.length === 0) return result;

  const tx = executor ?? getDb();
  const rows = await tx
    .select({ id: variants.id, onHand: variants.onHand })
    .from(variants)
    .where(inArray(variants.id, [...variantIds]));

  const held = await heldQtyMap(
    rows.map((row) => row.id),
    tx,
  );

  for (const row of rows) {
    result.set(row.id, Math.max(0, row.onHand - (held.get(row.id) ?? 0)));
  }
  return result;
}

/**
 * Reserva stock para un pedido.
 *
 * Corre en una transacción y toma `SELECT ... FOR UPDATE` sobre cada variante
 * **antes** de recalcular la disponibilidad: el chequeo y la inserción quedan
 * del mismo lado del lock, que es lo único que evita el sobreventa cuando dos
 * checkouts pelean por la última unidad.
 */
export async function reserveStock(
  orderId: number,
  items: readonly ReserveItem[],
  options: { expiresAt: Date; executor?: Executor },
): Promise<{ reserved: number }> {
  if (items.length === 0) return { reserved: 0 };

  // Siempre en el mismo orden de variante: dos pedidos con los mismos ítems en
  // orden distinto se deadlockean tomando los locks cruzados.
  const ordered = [...items].sort((a, b) => a.variantId - b.variantId);

  const run = async (tx: Executor) => {
    for (const item of ordered) {
      if (!Number.isInteger(item.qty) || item.qty <= 0) {
        throw new Error(`qty inválida para la variante ${item.variantId}: ${item.qty}`);
      }

      const locked = await tx
        .select({ onHand: variants.onHand, isActive: variants.isActive })
        .from(variants)
        .where(eq(variants.id, item.variantId))
        .for('update');

      const variant = locked[0];
      if (!variant || !variant.isActive) {
        throw new InsufficientStockError(item.variantId, item.qty, 0);
      }

      const available = variant.onHand - (await heldQtyForUpdate(tx, item.variantId));
      if (item.qty > available) {
        throw new InsufficientStockError(item.variantId, item.qty, Math.max(0, available));
      }

      await tx.insert(stockReservations).values({
        variantId: item.variantId,
        orderId,
        qty: item.qty,
        expiresAt: options.expiresAt,
        state: 'held',
      });
    }
    return { reserved: ordered.length };
  };

  // El `sort` de arriba evita que dos reservas se traben entre sí, pero no
  // sirve contra una transacción que toma los mismos locks desde otras tablas
  // —aplicar un pago, por ejemplo, que va por el pedido y sus reservas—. Ahí
  // MySQL rompe el empate matando a una de las dos, y el comprador que perdió
  // se comía un error crudo de la base en vez del "sin stock" de más arriba.
  //
  // Sólo cuando somos dueños de la transacción: si nos pasaron un executor,
  // estamos adentro de una transacción ajena que ya quedó abortada, y
  // reintentar acá no la resucita. Ese reintento le toca al de afuera.
  return options.executor
    ? run(options.executor)
    : withLockRetry(() => getDb().transaction(run));
}

export function reservationExpiry(
  method: keyof typeof RESERVATION_TTL_MINUTES,
  from: Date = new Date(),
): Date {
  return new Date(from.getTime() + RESERVATION_TTL_MINUTES[method] * 60_000);
}
