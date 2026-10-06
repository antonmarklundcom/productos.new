import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { MessageKey, Params } from '@/i18n';

import { DomainError } from './errors';

import { getDb } from '@/db';
import { coupons, orders, type CouponType } from '@/db/schema';
import { assertGs } from '@/lib/money';

import { normalizeCouponCode } from './coupons';
import type { Executor } from './executor';

/**
 * ABM de cupones para el panel (PLAN.md FASE 2, PR G.4).
 *
 * Owner-only desde la acción; acá viven las validaciones que no se pueden
 * confiar al formulario porque son sobre plata.
 */

export class AdminCouponError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = 'AdminCouponError';
  }
}

export type AdminCouponRow = {
  id: number;
  code: string;
  type: CouponType;
  value: number;
  minOrderPyg: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  timesUsed: number;
  soloClientes: boolean;
  isActive: boolean;
  /** Cuántos pedidos lo usaron de verdad. Al lado de `timesUsed` para poder
   *  ver de un vistazo si el contador se despegó (lo mira `pnpm reconcile`). */
  orderCount: number;
  /** Cuánto descontó en total. Es plata que la tienda resignó. */
  discountedPyg: number;
};

export async function listAdminCoupons(executor?: Executor): Promise<AdminCouponRow[]> {
  const tx = executor ?? getDb();

  const rows = await tx
    .select({
      id: coupons.id,
      code: coupons.code,
      type: coupons.type,
      value: coupons.value,
      minOrderPyg: coupons.minOrderPyg,
      startsAt: coupons.startsAt,
      endsAt: coupons.endsAt,
      maxUses: coupons.maxUses,
      maxUsesPerCustomer: coupons.maxUsesPerCustomer,
      timesUsed: coupons.timesUsed,
      soloClientes: coupons.soloClientes,
      isActive: coupons.isActive,
      createdAt: coupons.createdAt,
    })
    .from(coupons)
    .orderBy(desc(coupons.createdAt));

  const usage = await tx
    .select({
      couponId: orders.couponId,
      orderCount: count(),
      discountedPyg: sql<number>`COALESCE(SUM(${orders.discountPyg}), 0)`,
    })
    .from(orders)
    .where(sql`${orders.couponId} IS NOT NULL`)
    .groupBy(orders.couponId);

  const byCoupon = new Map(usage.map((row) => [Number(row.couponId), row]));

  return rows.map((row) => ({
    ...row,
    orderCount: Number(byCoupon.get(row.id)?.orderCount ?? 0),
    discountedPyg: Number(byCoupon.get(row.id)?.discountedPyg ?? 0),
  }));
}

export type CouponInput = {
  code: string;
  type: CouponType;
  value: number;
  minOrderPyg?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  maxUses?: number | null;
  maxUsesPerCustomer?: number | null;
  soloClientes?: boolean;
  isActive?: boolean;
};

/**
 * Las validaciones de plata, en un solo lugar.
 *
 * Están acá y no en el schema de la acción porque son reglas de negocio: un
 * porcentaje de 150 no es un problema de formato, es un cupón que le paga al
 * comprador por llevarse la mercadería.
 */
function validate(input: CouponInput): void {
  const code = normalizeCouponCode(input.code);
  if (code.length < 3) throw new AdminCouponError('adminError.cupon.codigoCorto');

  if (!Number.isInteger(input.value) || input.value <= 0) {
    throw new AdminCouponError('adminError.cupon.valor');
  }

  if (input.type === 'porcentaje' && input.value > 100) {
    throw new AdminCouponError('adminError.cupon.porcentaje');
  }

  if (input.type === 'monto_fijo') {
    assertGs(input.value, 'valor del cupón');
  }

  if (input.minOrderPyg != null) assertGs(input.minOrderPyg, 'mínimo de compra');

  if (input.startsAt && input.endsAt && input.startsAt > input.endsAt) {
    throw new AdminCouponError('adminError.cupon.fechas');
  }

  if (input.maxUses != null && (!Number.isInteger(input.maxUses) || input.maxUses < 1)) {
    throw new AdminCouponError('adminError.cupon.topeUsos');
  }

  if (
    input.maxUsesPerCustomer != null &&
    (!Number.isInteger(input.maxUsesPerCustomer) || input.maxUsesPerCustomer < 1)
  ) {
    throw new AdminCouponError('adminError.cupon.topeCliente');
  }
}

export async function createCoupon(input: CouponInput): Promise<number> {
  validate(input);
  const code = normalizeCouponCode(input.code);

  return getDb().transaction(async (tx) => {
    const existing = await tx.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, code)).limit(1);
    if (existing[0]) throw new AdminCouponError('adminError.cupon.codigoRepetido');

    await tx.insert(coupons).values({
      code,
      type: input.type,
      value: input.value,
      minOrderPyg: input.minOrderPyg ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      maxUses: input.maxUses ?? null,
      maxUsesPerCustomer: input.maxUsesPerCustomer ?? null,
      soloClientes: input.soloClientes ?? false,
      isActive: input.isActive ?? true,
    });

    const created = await tx.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, code)).limit(1);
    const id = created[0]?.id;
    if (!id) throw new AdminCouponError('adminError.cupon.noPude');
    return id;
  });
}

/**
 * Editar un cupón.
 *
 * **El código y el tipo/valor de un cupón ya usado no se tocan.** Un cupón con
 * pedidos encima es parte de la explicación de esos totales: cambiarle el
 * descuento de 10% a 50% haría que `pnpm reconcile` siguiera cuadrando —el
 * pedido guarda su propio `discount_pyg`— pero que nadie pudiera reconstruir
 * por qué ese pedido pagó lo que pagó. Lo que sí se puede es apagarlo, correrle
 * la vigencia o cambiarle los topes.
 */
export async function updateCoupon(id: number, input: CouponInput): Promise<void> {
  validate(input);
  const code = normalizeCouponCode(input.code);

  return getDb().transaction(async (tx) => {
    const rows = await tx.select().from(coupons).where(eq(coupons.id, id)).limit(1).for('update');
    const current = rows[0];
    if (!current) throw new AdminCouponError('adminError.cupon.noExiste');

    const used = await tx
      .select({ n: count() })
      .from(orders)
      .where(eq(orders.couponId, id));
    const yaSeUso = Number(used[0]?.n ?? 0) > 0;

    if (yaSeUso && (code !== current.code || input.type !== current.type || input.value !== current.value)) {
      throw new AdminCouponError('adminError.cupon.yaUsado');
    }

    const duplicate = await tx
      .select({ id: coupons.id })
      .from(coupons)
      .where(and(eq(coupons.code, code), sql`${coupons.id} <> ${id}`))
      .limit(1);
    if (duplicate[0]) throw new AdminCouponError('adminError.cupon.codigoRepetidoOtro');

    await tx
      .update(coupons)
      .set({
        code,
        type: input.type,
        value: input.value,
        minOrderPyg: input.minOrderPyg ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        maxUses: input.maxUses ?? null,
        maxUsesPerCustomer: input.maxUsesPerCustomer ?? null,
        soloClientes: input.soloClientes ?? false,
        isActive: input.isActive ?? true,
      })
      .where(eq(coupons.id, id));
  });
}

/**
 * Activar / desactivar. **No hay borrado**, por lo mismo que los usuarios: los
 * pedidos que lo usaron lo referencian, y un cupón apagado explica el pasado
 * sin poder usarse en el futuro.
 */
export async function setCouponActive(id: number, isActive: boolean): Promise<void> {
  const db = getDb();
  const rows = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.id, id)).limit(1);
  if (!rows[0]) throw new AdminCouponError('adminError.cupon.noExiste');

  await db.update(coupons).set({ isActive }).where(eq(coupons.id, id));
}
