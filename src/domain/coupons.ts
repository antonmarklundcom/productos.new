import { and, count, eq, sql } from 'drizzle-orm';

import { getDb } from '@/db';
import { coupons, orders, type CouponType } from '@/db/schema';
import { assertGs } from '@/lib/money';

import type { Executor } from './executor';

/**
 * Cupones de descuento (PLAN.md FASE 2, PR G).
 *
 * **Un descuento es plata.** De acá salen tres reglas que no se negocian:
 *
 * 1. **El navegador manda el código, nunca el monto.** El descuento lo calcula
 *    el servidor contra estas filas, adentro de `computeOrderTotals`.
 * 2. **Todo es entero.** El porcentaje se aplica con `Math.floor` sobre
 *    guaraníes enteros; no hay un solo float en el camino.
 * 3. **El descuento sale del subtotal, jamás del envío.** El flete lo paga el
 *    comercio o la compradora, y una promoción de la tienda no puede
 *    convertirlo en pérdida. La identidad queda
 *    `total = subtotal − descuento + envío`, y `pnpm reconcile` la verifica.
 */

/** Por qué no se pudo usar un cupón. El checkout traduce cada código. */
export type CouponRejection =
  | 'no_existe'
  | 'inactivo'
  | 'no_empezo'
  | 'vencido'
  | 'agotado'
  | 'agotado_para_vos'
  | 'minimo_no_alcanzado'
  | 'solo_clientes';

export type CouponSnapshot = {
  id: number;
  code: string;
  type: CouponType;
  value: number;
  minOrderPyg: number | null;
  soloClientes: boolean;
};

export type CouponResult =
  | { ok: true; coupon: CouponSnapshot; discountPyg: number }
  | { ok: false; reason: CouponRejection; minOrderPyg?: number };

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Cuánto descuenta este cupón sobre este subtotal. **Entero, siempre.**
 *
 * `Math.floor` y no `Math.round` en el porcentaje: ante un empate de medio
 * guaraní, el redondeo tiene que favorecer al comercio, que es quien paga la
 * promoción. Es un guaraní; lo que importa es que la regla sea una sola y esté
 * escrita.
 *
 * El tope es el subtotal: un cupón de ₲100.000 sobre una compra de ₲80.000
 * descuenta ₲80.000 y no deja un total negativo ni empieza a pagar el envío.
 */
export function computeDiscount(
  coupon: Pick<CouponSnapshot, 'type' | 'value'>,
  subtotalPyg: number,
): number {
  assertGs(subtotalPyg, 'subtotal_pyg');

  const raw =
    coupon.type === 'porcentaje'
      ? Math.floor((subtotalPyg * coupon.value) / 100)
      : coupon.value;

  return assertGs(Math.max(0, Math.min(raw, subtotalPyg)), 'discount_pyg');
}

/**
 * Reparte el descuento entre las líneas, en proporción a lo que pesa cada una.
 *
 * Existe por una razón muy concreta: el IVA se desglosa **por línea** y se
 * redondea por línea (ARCH.md §2), así que descontar del total y recalcular el
 * IVA sobre el resultado daría un desglose que no corresponde a ninguna línea
 * real. Con el reparto, cada línea queda con su base descontada y su IVA se
 * calcula como siempre, con el mismo `ivaIncluded` de siempre.
 *
 * El resto de la división entera se le da a la línea más grande: así la suma de
 * los descuentos por línea es **exactamente** el descuento total, sin un
 * guaraní perdido en el redondeo.
 */
export function distributeDiscount(
  lineTotals: readonly number[],
  discountPyg: number,
): number[] {
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  if (discountPyg <= 0 || subtotal <= 0) return lineTotals.map(() => 0);

  const shares = lineTotals.map((lineTotalPyg) =>
    Math.floor((lineTotalPyg * discountPyg) / subtotal),
  );

  let assigned = shares.reduce((sum, value) => sum + value, 0);
  let remainder = discountPyg - assigned;

  // El resto va a las líneas más grandes, de a un guaraní. Nunca deja una
  // línea descontada por encima de su propio total.
  const byWeight = lineTotals
    .map((lineTotalPyg, index) => ({ index, lineTotalPyg }))
    .sort((a, b) => b.lineTotalPyg - a.lineTotalPyg);

  let cursor = 0;
  while (remainder > 0 && cursor < byWeight.length * 2) {
    const target = byWeight[cursor % byWeight.length];
    if (target && shares[target.index]! < target.lineTotalPyg) {
      shares[target.index] = shares[target.index]! + 1;
      remainder -= 1;
    }
    cursor += 1;
  }

  assigned = shares.reduce((sum, value) => sum + value, 0);
  if (assigned !== discountPyg - Math.max(0, remainder)) {
    // Defensa: si esto pasa, algo del reparto está mal y es mejor no cobrar.
    throw new Error(`El reparto del descuento no cierra: ${assigned} ≠ ${discountPyg}`);
  }

  return shares;
}

/**
 * Valida un cupón contra la DB y devuelve cuánto descuenta.
 *
 * **Sólo lee.** No incrementa `times_used` — eso pasa recién cuando el pedido
 * se crea de verdad, adentro de su transacción y con la fila bloqueada (ver
 * `lockCouponForUse`). Esta función la usa también la cotización pública, que
 * no puede gastar usos de nada.
 */
export async function validateCoupon(
  code: string,
  input: {
    subtotalPyg: number;
    customerId?: number | null;
    customerPhone?: string | null;
    now?: Date;
  },
  executor?: Executor,
): Promise<CouponResult> {
  const tx = executor ?? getDb();
  const normalized = normalizeCouponCode(code);
  if (normalized === '') return { ok: false, reason: 'no_existe' };

  const rows = await tx.select().from(coupons).where(eq(coupons.code, normalized)).limit(1);
  const row = rows[0];

  // "No existe" e "inactivo" se separan sólo para el log del dueño: hacia la
  // compradora, el checkout muestra el mismo "ese código no sirve".
  if (!row) return { ok: false, reason: 'no_existe' };
  if (!row.isActive) return { ok: false, reason: 'inactivo' };

  const now = input.now ?? new Date();
  if (row.startsAt && now < row.startsAt) return { ok: false, reason: 'no_empezo' };
  if (row.endsAt && now > row.endsAt) return { ok: false, reason: 'vencido' };

  if (row.soloClientes && !input.customerId) return { ok: false, reason: 'solo_clientes' };

  if (row.maxUses !== null && row.timesUsed >= row.maxUses) {
    return { ok: false, reason: 'agotado' };
  }

  if (row.minOrderPyg !== null && input.subtotalPyg < row.minOrderPyg) {
    return { ok: false, reason: 'minimo_no_alcanzado', minOrderPyg: row.minOrderPyg };
  }

  if (row.maxUsesPerCustomer !== null) {
    const used = await countCustomerUses(tx, row.id, input);
    if (used >= row.maxUsesPerCustomer) return { ok: false, reason: 'agotado_para_vos' };
  }

  const snapshot: CouponSnapshot = {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    minOrderPyg: row.minOrderPyg,
    soloClientes: row.soloClientes,
  };

  return { ok: true, coupon: snapshot, discountPyg: computeDiscount(snapshot, input.subtotalPyg) };
}

/**
 * Cuántas veces usó este cupón esta persona.
 *
 * Por `customer_id` si tiene cuenta; por teléfono si compró de invitada. El
 * teléfono es más débil —se puede tipear otro— pero es la única identidad que
 * hay en un checkout sin registro, y dejar el límite por cliente sin efecto
 * para invitados sería peor.
 */
async function countCustomerUses(
  tx: Executor,
  couponId: number,
  input: { customerId?: number | null; customerPhone?: string | null },
  options: { locking?: boolean } = {},
): Promise<number> {
  const who = input.customerId
    ? eq(orders.customerId, input.customerId)
    : input.customerPhone
      ? eq(orders.customerPhone, input.customerPhone)
      : null;

  if (!who) return 0;

  const query = tx
    .select({ n: count() })
    .from(orders)
    .where(and(eq(orders.couponId, couponId), who));

  // Con el candado del cupón tomado, una lectura común sigue viendo la foto
  // que la transacción sacó **antes** de esperarlo (REPEATABLE READ): no ve
  // el pedido que el checkout de al lado acaba de commitear, y el mismo
  // WhatsApp se lleva el descuento dos veces. Una lectura con candado lee lo
  // último commiteado — el mismo truco que `heldQtyForUpdate` en stock.ts.
  //
  // `FOR UPDATE` y no `FOR SHARE`: MariaDB (la base de Hostinger) no conoce
  // `FOR SHARE` y la consulta entera falla, o sea el checkout con un cupón
  // con tope por cliente. Para leer lo último commiteado alcanza cualquiera de
  // los dos, y el candado del cupón ya serializa a los que compiten.
  const rows = options.locking ? await query.for('update') : await query;

  return Number(rows[0]?.n ?? 0);
}

export class CouponRaceError extends Error {
  constructor(readonly reason: CouponRejection) {
    super('Ese código se agotó mientras confirmabas el pedido.');
    this.name = 'CouponRaceError';
  }
}

/**
 * Toma el cupón **para usarlo**, adentro de la transacción que crea el pedido.
 *
 * Es el mismo patrón que el stock: `SELECT ... FOR UPDATE` sobre la fila, se
 * re-verifica el tope **con el candado tomado**, y recién ahí se incrementa.
 * Sin esto, dos checkouts simultáneos con un cupón de un solo uso leen
 * `times_used = 0` los dos, los dos pasan la validación y los dos cobran el
 * descuento.
 *
 * La validación de arriba no alcanza justamente porque pasó antes del candado:
 * lo que decide es esta re-lectura.
 */
export async function lockCouponForUse(
  tx: Executor,
  couponId: number,
  input: { customerId?: number | null; customerPhone?: string | null; now?: Date },
): Promise<void> {
  const locked = await tx
    .select({
      id: coupons.id,
      isActive: coupons.isActive,
      startsAt: coupons.startsAt,
      endsAt: coupons.endsAt,
      maxUses: coupons.maxUses,
      maxUsesPerCustomer: coupons.maxUsesPerCustomer,
      timesUsed: coupons.timesUsed,
    })
    .from(coupons)
    .where(eq(coupons.id, couponId))
    .for('update');

  const row = locked[0];
  if (!row) throw new CouponRaceError('no_existe');
  if (!row.isActive) throw new CouponRaceError('inactivo');

  const now = input.now ?? new Date();
  if (row.startsAt && now < row.startsAt) throw new CouponRaceError('no_empezo');
  if (row.endsAt && now > row.endsAt) throw new CouponRaceError('vencido');

  if (row.maxUses !== null && row.timesUsed >= row.maxUses) {
    throw new CouponRaceError('agotado');
  }

  if (row.maxUsesPerCustomer !== null) {
    const used = await countCustomerUses(tx, couponId, input, { locking: true });
    if (used >= row.maxUsesPerCustomer) throw new CouponRaceError('agotado_para_vos');
  }

  await tx
    .update(coupons)
    .set({ timesUsed: sql`${coupons.timesUsed} + 1` })
    .where(eq(coupons.id, couponId));
}

/**
 * ¿Esta tienda tiene algún cupón que valga la pena ofrecer?
 *
 * Decide si el checkout dibuja el campo de descuento. "Cero cupones = nada
 * visible" es el guardarraíl 1 del plan: una tienda que nunca cargó un cupón
 * tiene el checkout de siempre, sin un campo de más que invite a buscar
 * códigos en Google.
 *
 * Cuenta sólo los activos y vigentes: un cupón vencido no es motivo para
 * mostrarle a nadie un campo que sólo puede fallar.
 */
export async function hasUsableCoupons(executor?: Executor): Promise<boolean> {
  const tx = executor ?? getDb();
  const now = new Date();

  const rows = await tx
    .select({ n: count() })
    .from(coupons)
    .where(
      and(
        eq(coupons.isActive, true),
        sql`(${coupons.startsAt} IS NULL OR ${coupons.startsAt} <= ${now})`,
        sql`(${coupons.endsAt} IS NULL OR ${coupons.endsAt} >= ${now})`,
        sql`(${coupons.maxUses} IS NULL OR ${coupons.timesUsed} < ${coupons.maxUses})`,
      ),
    );

  return Number(rows[0]?.n ?? 0) > 0;
}
