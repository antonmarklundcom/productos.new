import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { orderItems, orders, products, variants, type OrderStatus } from "@/db/schema";
import { startOfDayPY, startOfMonthPY, startOfNextDayPY } from "@/lib/py";

import type { Executor } from "./executor";

/**
 * Números del resumen (PLAN.md 4.7).
 *
 * "Ventas de hoy" cuenta lo **cobrado**, no lo pedido: un pedido en
 * `pendiente_pago` todavía puede vencer, y meterlo en la caja del día hace que
 * el panel muestre plata que no entró. El corte del día es a medianoche de
 * Asunción, no de UTC (ver `lib/py`).
 */

/** Estados en los que la plata ya entró y no volvió. */
export const REVENUE_STATUSES: readonly OrderStatus[] = [
  "pagado",
  "preparando",
  "enviado",
  "entregado",
];

export type SalesTotals = {
  /** Suma de `total_pyg`. Entero, guaraníes. */
  totalPyg: number;
  orders: number;
};

async function salesBetween(
  tx: Executor,
  from: Date,
  to: Date | null,
): Promise<SalesTotals> {
  const [row] = await tx
    .select({
      // COALESCE porque SUM sobre cero filas devuelve NULL, no 0.
      totalPyg: sql<string | number>`COALESCE(SUM(${orders.totalPyg}), 0)`,
      orders: count(),
    })
    .from(orders)
    .where(
      and(
        inArray(orders.status, [...REVENUE_STATUSES]),
        gte(orders.createdAt, from),
        to ? lt(orders.createdAt, to) : undefined,
      ),
    );

  return {
    // mysql2 devuelve la suma de un BIGINT como string cuando no entra en un
    // número exacto: se normaliza acá, una sola vez.
    totalPyg: Number(row?.totalPyg ?? 0),
    orders: row?.orders ?? 0,
  };
}

export type DashboardSummary = {
  today: SalesTotals;
  month: SalesTotals;
  awaitingVerification: number;
  pendingPayment: number;
};

export async function getDashboardSummary(
  now: Date = new Date(),
  executor?: Executor,
): Promise<DashboardSummary> {
  const tx = executor ?? getDb();

  const [today, month, awaiting, pending] = await Promise.all([
    salesBetween(tx, startOfDayPY(now), startOfNextDayPY(now)),
    salesBetween(tx, startOfMonthPY(now), null),
    tx
      .select({ total: count() })
      .from(orders)
      .where(inArray(orders.status, ["esperando_verificacion"])),
    tx.select({ total: count() }).from(orders).where(inArray(orders.status, ["pendiente_pago"])),
  ]);

  return {
    today,
    month,
    awaitingVerification: awaiting[0]?.total ?? 0,
    pendingPayment: pending[0]?.total ?? 0,
  };
}

export type TopProduct = {
  productId: number;
  name: string;
  /** Unidades vendidas en el período. */
  qty: number;
  /** Lo facturado por ese producto. Entero, guaraníes. */
  totalPyg: number;
};

/**
 * Los productos que más se vendieron en el mes (PLAN.md 4.7).
 *
 * Mismo criterio de "cobrado" que las ventas de arriba (`REVENUE_STATUSES`) y
 * mismo corte de mes paraguayo: un top que contara pedidos sin pagar diría que
 * el producto estrella es el que más se abandona en el checkout.
 *
 * Se agrupa por producto y no por variante: al dueño le sirve saber que el
 * corpiño de encaje se vende, no que se vende en 90B. El nombre sale de
 * `products` y no del snapshot del ítem porque el snapshot trae pegado el
 * talle y el color.
 */
export async function topProducts(
  now: Date = new Date(),
  limit = 5,
  executor?: Executor,
): Promise<TopProduct[]> {
  const tx = executor ?? getDb();

  const rows = await tx
    .select({
      productId: products.id,
      name: products.name,
      qty: sql<string | number>`SUM(${orderItems.qty})`,
      totalPyg: sql<string | number>`SUM(${orderItems.lineTotalPyg})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(variants, eq(orderItems.variantId, variants.id))
    .innerJoin(products, eq(variants.productId, products.id))
    .where(
      and(
        inArray(orders.status, [...REVENUE_STATUSES]),
        gte(orders.createdAt, startOfMonthPY(now)),
      ),
    )
    .groupBy(products.id, products.name)
    .orderBy(desc(sql`SUM(${orderItems.qty})`), desc(sql`SUM(${orderItems.lineTotalPyg})`))
    .limit(limit);

  return rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    qty: Number(row.qty),
    totalPyg: Number(row.totalPyg),
  }));
}

export type SalesDay = {
  /** Medianoche paraguaya de ese día, en UTC. */
  day: Date;
  totalPyg: number;
  orders: number;
};

/**
 * Ventas de los últimos días, uno por uno (PLAN.md 4.7).
 *
 * Los cortes de día se calculan en JS con `startOfDayPY` y la consulta suma
 * con un `CASE` por día. La alternativa —`GROUP BY DATE(CONVERT_TZ(...))`—
 * depende de que el MySQL tenga cargadas las tablas de zonas horarias, que en
 * un hosting compartido puede no estar: ahí `CONVERT_TZ` devuelve NULL y el
 * gráfico queda en blanco sin un error que lo explique.
 *
 * Devuelve todos los días del rango, incluidos los que no vendieron nada: una
 * serie con huecos se lee como si esos días no existieran.
 */
export async function salesTrend(
  now: Date = new Date(),
  days = 7,
  executor?: Executor,
): Promise<SalesDay[]> {
  const tx = executor ?? getDb();

  // De hace `days - 1` días hasta hoy. Se camina hacia atrás desde el inicio
  // de hoy restando 24 h y volviendo a `startOfDayPY`, que es a prueba de un
  // eventual cambio de offset.
  const starts: Date[] = [startOfDayPY(now)];
  for (let i = 1; i < days; i += 1) {
    const previous = starts[0];
    if (!previous) break;
    starts.unshift(startOfDayPY(new Date(previous.getTime() - 12 * 3600_000)));
  }

  const first = starts[0];
  const last = startOfNextDayPY(now);
  if (!first) return [];

  const columns = Object.fromEntries(
    starts.flatMap((start, index) => {
      const end = starts[index + 1] ?? last;
      const inDay = sql`${orders.createdAt} >= ${start} AND ${orders.createdAt} < ${end}`;
      return [
        [`total${index}`, sql<string | number>`COALESCE(SUM(CASE WHEN ${inDay} THEN ${orders.totalPyg} ELSE 0 END), 0)`],
        [`orders${index}`, sql<string | number>`SUM(CASE WHEN ${inDay} THEN 1 ELSE 0 END)`],
      ];
    }),
  );

  const [row] = await tx
    .select(columns)
    .from(orders)
    .where(
      and(
        inArray(orders.status, [...REVENUE_STATUSES]),
        gte(orders.createdAt, first),
        lt(orders.createdAt, last),
      ),
    );

  return starts.map((day, index) => ({
    day,
    totalPyg: Number(row?.[`total${index}`] ?? 0),
    orders: Number(row?.[`orders${index}`] ?? 0),
  }));
}
