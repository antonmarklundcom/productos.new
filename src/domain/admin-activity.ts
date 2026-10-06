import { and, count, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { unionAll, type MySqlColumn } from 'drizzle-orm/mysql-core';

import { getDb } from '@/db';
import {
  orderEvents,
  orderNotes,
  orders,
  products,
  stockAdjustments,
  users,
  variants,
  type OrderStatus,
} from '@/db/schema';

import type { Executor } from './executor';

/**
 * El feed de actividad del panel (PLAN.md FASE 2, PR L).
 *
 * Contesta una pregunta que hoy no tiene pantalla: **"¿qué hizo X hoy?"**.
 * `order_events` y `stock_adjustments` ya guardaban todo desde el principio,
 * pero repartido: los eventos de un pedido sólo se ven abriendo ese pedido, y
 * los ajustes de stock sólo abriendo esa variante. Para revisar el turno de
 * alguien había que adivinar por dónde empezar.
 *
 * Las dos tablas son append-only y nadie las edita, así que esto es puramente
 * de lectura. El `actor_user_id` que hace posible el filtro por persona lo
 * agregó el PR D.
 *
 * ### Por qué una UNION y no dos consultas mezcladas en memoria
 *
 * La tentación es traer 50 eventos y 50 ajustes y ordenarlos con `.sort()`.
 * Funciona en la página 1 y miente en la 2: si en el rango entraron 300
 * eventos y 3 ajustes, los 50 eventos más nuevos tapan a los ajustes, y la
 * página 2 muestra cosas que en un feed real irían antes. La paginación de un
 * feed unificado sólo es correcta si el `ORDER BY … LIMIT … OFFSET` lo hace la
 * base sobre el conjunto entero.
 *
 * El `UNION ALL` trae sólo `(tipo, id, fecha)`: lo mínimo para ordenar y
 * paginar. Los detalles —número de pedido, SKU, nombre del producto— se
 * buscan después y sólo para las filas de esta página, con una consulta por
 * tabla. Traerlos adentro de la unión obligaría a que las dos ramas tuvieran
 * las mismas columnas, con la mitad en NULL de cada lado.
 */

export const ACTIVITY_PER_PAGE = 30;

export const ACTIVITY_KINDS = ['pedido', 'stock', 'nota'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export function isActivityKind(value: string | undefined): value is ActivityKind {
  return value !== undefined && (ACTIVITY_KINDS as readonly string[]).includes(value);
}

export type ActivityFilters = {
  /** Sin esto, las dos tablas. Con esto, una sola (y ni siquiera hay unión). */
  kind?: ActivityKind;
  /**
   * Quién. `"sistema"` es un filtro legítimo y distinto de "sin filtro": son
   * las filas con `actor_user_id IS NULL` —el cron que vence pedidos, el
   * webhook de Pagopar, la compradora subiendo su comprobante— y es
   * exactamente lo que se quiere mirar cuando algo cambió y nadie lo tocó.
   */
  actorUserId?: number | 'sistema';
  /** Instantes UTC ya convertidos desde el día paraguayo (ver lib/py). */
  createdFrom?: Date;
  createdTo?: Date;
  page?: number;
  perPage?: number;
};

export type ActivityRow =
  | {
      kind: 'pedido';
      id: number;
      createdAt: Date;
      actor: string;
      actorUserId: number | null;
      actorName: string | null;
      orderId: number;
      orderNumber: string;
      fromStatus: OrderStatus | null;
      toStatus: OrderStatus;
      reason: string | null;
    }
  | {
      kind: 'stock';
      id: number;
      createdAt: Date;
      actor: string;
      actorUserId: number | null;
      actorName: string | null;
      variantId: number;
      sku: string;
      productName: string;
      productId: number;
      delta: number;
      previousOnHand: number;
      newOnHand: number;
      reason: string;
    }
  | {
      kind: 'nota';
      id: number;
      createdAt: Date;
      actor: string;
      actorUserId: number | null;
      actorName: string | null;
      orderId: number;
      orderNumber: string;
      body: string;
    };

export type ActivityPage = {
  rows: ActivityRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

/**
 * El mismo filtro para las dos tablas, que por suerte tienen las tres columnas
 * con el mismo nombre (`created_at`, `actor_user_id`).
 */
function condiciones(
  filters: ActivityFilters,
  columnas: { createdAt: MySqlColumn; actorUserId: MySqlColumn },
): SQL | undefined {
  return and(
    filters.createdFrom ? gte(columnas.createdAt, filters.createdFrom) : undefined,
    // `lt` y no `lte`: el "hasta" viene como el arranque del día siguiente
    // (`parsePyDateInputEnd`), así que el día elegido entra completo.
    filters.createdTo ? lt(columnas.createdAt, filters.createdTo) : undefined,
    filters.actorUserId === undefined
      ? undefined
      : filters.actorUserId === 'sistema'
        ? sql`${columnas.actorUserId} IS NULL`
        : eq(columnas.actorUserId, filters.actorUserId),
  );
}

export async function listActivity(
  filters: ActivityFilters = {},
  executor?: Executor,
): Promise<ActivityPage> {
  const tx = executor ?? getDb();
  const perPage = Math.min(100, Math.max(1, filters.perPage ?? ACTIVITY_PER_PAGE));
  const page = Math.max(1, filters.page ?? 1);

  const wherePedidos = condiciones(filters, orderEvents);
  const whereStock = condiciones(filters, stockAdjustments);
  const whereNotas = condiciones(filters, orderNotes);

  // Un filtro por tipo apaga los otros dos conteos: el total tiene que ser el
  // de lo que se va a listar, o la paginación promete páginas que no existen.
  const cuenta = async (kind: ActivityKind, consulta: Promise<Array<{ n: number }>>) =>
    filters.kind !== undefined && filters.kind !== kind
      ? 0
      : Number((await consulta)[0]?.n ?? 0);

  const cuentaPedidos = await cuenta(
    'pedido',
    tx.select({ n: count() }).from(orderEvents).where(wherePedidos),
  );
  const cuentaStock = await cuenta(
    'stock',
    tx.select({ n: count() }).from(stockAdjustments).where(whereStock),
  );
  const cuentaNotas = await cuenta(
    'nota',
    tx.select({ n: count() }).from(orderNotes).where(whereNotas),
  );

  const total = cuentaPedidos + cuentaStock + cuentaNotas;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  // Si el filtro achicó el resultado, `?page=9` no puede quedar en una página
  // vacía sin explicación. Mismo criterio que el listado de pedidos.
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * perPage;

  const claves = await clavesDeLaPagina(tx, filters, {
    wherePedidos,
    whereStock,
    whereNotas,
    perPage,
    offset,
  });
  const rows = await hidratar(tx, claves);

  return { rows, total, page: safePage, perPage, totalPages };
}

type Clave = { kind: ActivityKind; id: number };

/**
 * Qué filas entran en esta página, en orden, sin traer todavía sus detalles.
 *
 * El desempate por `id` importa: dos eventos del mismo pedido escritos en la
 * misma transacción comparten `created_at` al segundo, y sin un segundo
 * criterio MySQL puede devolverlos en cualquier orden entre página y página —
 * con el resultado de que una fila aparece dos veces y otra no aparece nunca.
 */
async function clavesDeLaPagina(
  tx: Executor,
  filters: ActivityFilters,
  opciones: {
    wherePedidos: SQL | undefined;
    whereStock: SQL | undefined;
    whereNotas: SQL | undefined;
    perPage: number;
    offset: number;
  },
): Promise<Clave[]> {
  const { wherePedidos, whereStock, whereNotas, perPage, offset } = opciones;

  if (filters.kind === 'pedido') {
    const rows = await tx
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(wherePedidos)
      .orderBy(desc(orderEvents.createdAt), desc(orderEvents.id))
      .limit(perPage)
      .offset(offset);
    return rows.map((row) => ({ kind: 'pedido' as const, id: row.id }));
  }

  if (filters.kind === 'stock') {
    const rows = await tx
      .select({ id: stockAdjustments.id })
      .from(stockAdjustments)
      .where(whereStock)
      .orderBy(desc(stockAdjustments.createdAt), desc(stockAdjustments.id))
      .limit(perPage)
      .offset(offset);
    return rows.map((row) => ({ kind: 'stock' as const, id: row.id }));
  }

  if (filters.kind === 'nota') {
    const rows = await tx
      .select({ id: orderNotes.id })
      .from(orderNotes)
      .where(whereNotas)
      .orderBy(desc(orderNotes.createdAt), desc(orderNotes.id))
      .limit(perPage)
      .offset(offset);
    return rows.map((row) => ({ kind: 'nota' as const, id: row.id }));
  }

  const pedidos = tx
    .select({
      kind: sql<ActivityKind>`'pedido'`.as('kind'),
      id: orderEvents.id,
      createdAt: orderEvents.createdAt,
    })
    .from(orderEvents)
    .where(wherePedidos);

  const stock = tx
    .select({
      kind: sql<ActivityKind>`'stock'`.as('kind'),
      id: stockAdjustments.id,
      createdAt: stockAdjustments.createdAt,
    })
    .from(stockAdjustments)
    .where(whereStock);

  const notas = tx
    .select({
      kind: sql<ActivityKind>`'nota'`.as('kind'),
      id: orderNotes.id,
      createdAt: orderNotes.createdAt,
    })
    .from(orderNotes)
    .where(whereNotas);

  // El ORDER BY de una UNION se resuelve contra los **alias de salida**, no
  // contra las columnas de una tabla: por eso van escritos a mano y no con
  // `desc(orderEvents.createdAt)`, que emitiría `order_events`.`created_at` y
  // MySQL lo rechaza.
  const filas = await unionAll(pedidos, stock, notas)
    .orderBy(sql`\`created_at\` DESC, \`kind\` ASC, \`id\` DESC`)
    .limit(perPage)
    .offset(offset);

  return filas.map((row) => ({ kind: row.kind, id: row.id }));
}

/** Los detalles de las filas de esta página: una consulta por tabla. */
async function hidratar(tx: Executor, claves: Clave[]): Promise<ActivityRow[]> {
  const idsPedido = claves.filter((clave) => clave.kind === 'pedido').map((clave) => clave.id);
  const idsStock = claves.filter((clave) => clave.kind === 'stock').map((clave) => clave.id);
  const idsNota = claves.filter((clave) => clave.kind === 'nota').map((clave) => clave.id);

  const [eventos, ajustes, notas] = await Promise.all([
    idsPedido.length === 0
      ? []
      : tx
          .select({
            id: orderEvents.id,
            createdAt: orderEvents.createdAt,
            actor: orderEvents.actor,
            actorUserId: orderEvents.actorUserId,
            actorName: users.name,
            actorEmail: users.email,
            orderId: orderEvents.orderId,
            orderNumber: orders.orderNumber,
            fromStatus: orderEvents.fromStatus,
            toStatus: orderEvents.toStatus,
            reason: orderEvents.reason,
          })
          .from(orderEvents)
          .innerJoin(orders, eq(orderEvents.orderId, orders.id))
          // LEFT: la mayoría de los eventos no los movió nadie del panel.
          .leftJoin(users, eq(orderEvents.actorUserId, users.id))
          .where(inArray(orderEvents.id, idsPedido)),
    idsStock.length === 0
      ? []
      : tx
          .select({
            id: stockAdjustments.id,
            createdAt: stockAdjustments.createdAt,
            actor: stockAdjustments.actor,
            actorUserId: stockAdjustments.actorUserId,
            actorName: users.name,
            actorEmail: users.email,
            variantId: stockAdjustments.variantId,
            sku: variants.sku,
            productId: products.id,
            productName: products.name,
            delta: stockAdjustments.delta,
            previousOnHand: stockAdjustments.previousOnHand,
            newOnHand: stockAdjustments.newOnHand,
            reason: stockAdjustments.reason,
          })
          .from(stockAdjustments)
          .innerJoin(variants, eq(stockAdjustments.variantId, variants.id))
          .innerJoin(products, eq(variants.productId, products.id))
          .leftJoin(users, eq(stockAdjustments.actorUserId, users.id))
          .where(inArray(stockAdjustments.id, idsStock)),
    idsNota.length === 0
      ? []
      : tx
          .select({
            id: orderNotes.id,
            createdAt: orderNotes.createdAt,
            actor: orderNotes.actor,
            actorUserId: orderNotes.actorUserId,
            actorName: users.name,
            actorEmail: users.email,
            orderId: orderNotes.orderId,
            orderNumber: orders.orderNumber,
            body: orderNotes.body,
          })
          .from(orderNotes)
          .innerJoin(orders, eq(orderNotes.orderId, orders.id))
          // LEFT, igual que arriba: la FK del actor es nullable por diseño.
          .leftJoin(users, eq(orderNotes.actorUserId, users.id))
          .where(inArray(orderNotes.id, idsNota)),
  ]);

  const porClave = new Map<string, ActivityRow>();

  for (const row of eventos) {
    porClave.set(`pedido:${row.id}`, {
      kind: 'pedido',
      id: row.id,
      createdAt: row.createdAt,
      actor: row.actor,
      actorUserId: row.actorUserId,
      actorName: nombreDelActor(row.actorName, row.actorEmail),
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      reason: row.reason,
    });
  }

  for (const row of ajustes) {
    porClave.set(`stock:${row.id}`, {
      kind: 'stock',
      id: row.id,
      createdAt: row.createdAt,
      actor: row.actor,
      actorUserId: row.actorUserId,
      actorName: nombreDelActor(row.actorName, row.actorEmail),
      variantId: row.variantId,
      sku: row.sku,
      productId: row.productId,
      productName: row.productName,
      delta: row.delta,
      previousOnHand: row.previousOnHand,
      newOnHand: row.newOnHand,
      reason: row.reason,
    });
  }

  for (const row of notas) {
    porClave.set(`nota:${row.id}`, {
      kind: 'nota',
      id: row.id,
      createdAt: row.createdAt,
      actor: row.actor,
      actorUserId: row.actorUserId,
      actorName: nombreDelActor(row.actorName, row.actorEmail),
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      body: row.body,
    });
  }

  // El orden lo decidió la base; acá sólo se respeta.
  return claves
    .map((clave) => porClave.get(`${clave.kind}:${clave.id}`))
    .filter((row): row is ActivityRow => row !== undefined);
}

/**
 * Cómo se nombra a quien hizo algo, **hoy**.
 *
 * Se prefiere el nombre actual del usuario al `actor` de texto que quedó
 * escrito, y no al revés: el string histórico dice `admin:ana@tienda.py` y
 * sigue siendo la verdad de lo que pasó, pero el dueño está buscando a Ana. La
 * pantalla muestra el nombre y deja el string abajo, así que no se pierde
 * ninguno de los dos.
 */
function nombreDelActor(name: string | null, email: string | null): string | null {
  return name?.trim() || email || null;
}

/**
 * Quiénes aparecen en el desplegable del filtro.
 *
 * **Todos los usuarios del panel, incluidos los desactivados.** Filtrar sólo
 * por los activos rompería justo la consulta que más importa: revisar qué hizo
 * alguien antes de que le cortaran el acceso.
 */
export async function actividadActores(
  executor?: Executor,
): Promise<Array<{ id: number; label: string; isActive: boolean }>> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive })
    .from(users)
    .orderBy(users.email);

  return rows.map((row) => ({
    id: row.id,
    label: row.name?.trim() || row.email,
    isActive: row.isActive,
  }));
}
