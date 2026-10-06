import { databaseDate } from "@/lib/database-date";
import { count, countDistinct, desc, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { normalizePhonePY } from "@/lib/py";

import { REVENUE_STATUSES } from "./admin-dashboard";
import type { Executor } from "./executor";

/**
 * Clientes derivados de los pedidos.
 *
 * No hay cuentas de cliente y no las va a haber: el checkout es de invitado a
 * propósito (PLAN.md "FASE 2", punto 2). Igual el comercio necesita saber
 * quién le compró tres veces, así que "cliente" acá es una **vista** sobre
 * `orders` agrupada por el WhatsApp, que es la llave que la compradora repite
 * entre compras. Ni tabla nueva ni migración.
 *
 * El teléfono ya está normalizado en la DB (`create-order.ts` lo pasa por
 * `normalizePhonePY` antes de insertar), así que agrupar por la columna
 * agrupa por número real y no por cómo lo tipeó cada una. Lo que sí se
 * normaliza acá es lo que el dueño escribe en el buscador.
 */

export const CUSTOMERS_PER_PAGE = 20;

export type AdminCustomerRow = {
  /** `+595981123456` — la llave del agrupamiento. */
  phone: string;
  /** El del pedido más reciente: si cambió de apellido, gana el último. */
  name: string;
  docNumber: string | null;
  orders: number;
  /** Cuántos de esos pedidos llegaron a cobrarse. */
  paidOrders: number;
  /** Suma de los pedidos cobrados. Entero, guaraníes. */
  lifetimePyg: number;
  lastOrderAt: Date;
};

export type AdminCustomerPage = {
  rows: AdminCustomerRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

/** `%` y `_` son comodines de LIKE: sin escaparlos, `%` lista todo. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Búsqueda por nombre, WhatsApp o RUC/CI.
 *
 * Las columnas van calificadas con el alias `o1` porque esto vive adentro de
 * la subconsulta de `phoneFilter`: interpolar `${orders.customerName}` acá las
 * emitiría apuntando a la tabla de afuera, y el filtro pasaría a ser
 * correlacionado — o sea, filtraría pedidos en vez de clientes.
 *
 * Cada forma de buscar es su propia condición y se combinan con OR, igual que
 * en el listado de pedidos: un RUC de nueve dígitos también parece un número
 * de celular paraguayo, así que probar sólo la primera hipótesis no encuentra
 * nada. El nombre queda de último recurso — es el único que no entra por un
 * índice.
 */
function searchCondition(rawTerm: string): SQL | undefined {
  const term = rawTerm.trim();
  if (term === "") return undefined;

  const conditions: SQL[] = [];

  const phone = normalizePhonePY(term);
  if (phone) conditions.push(sql`o1.\`customer_phone\` = ${phone}`);

  // RUC/CI sin puntos ni guion, contra el documento guardado también
  // normalizado: "80012345-6" y "800123456" encuentran lo mismo.
  const docDigits = term.replace(/[.\s-]/g, "");
  if (/^\d{4,10}$/.test(docDigits)) {
    conditions.push(
      sql`REPLACE(REPLACE(o1.\`doc_number\`, '-', ''), '.', '') = ${docDigits}`
    );
  }

  if (conditions.length === 0) {
    conditions.push(sql`o1.\`customer_name\` LIKE ${`%${escapeLike(term)}%`}`);
  }

  return conditions.length === 1
    ? conditions[0]
    : sql.join(conditions, sql` OR `);
}

/**
 * Los teléfonos que entran en el listado.
 *
 * Filtra clientes, no pedidos: el cliente que coincide entra con **todos** sus
 * pedidos. Si el `WHERE` se aplicara a las filas antes de agrupar, buscar
 * "Ana" mostraría un "gastó" que se olvida de los pedidos que hizo con otro
 * nombre.
 */
function phoneFilter(search: string | undefined): SQL | undefined {
  const condition = search ? searchCondition(search) : undefined;
  if (!condition) return undefined;

  return sql`${orders.customerPhone} IN (
    SELECT DISTINCT o1.\`customer_phone\` FROM \`orders\` AS o1 WHERE ${condition}
  )`;
}

/**
 * El dato del pedido más reciente de ese teléfono.
 *
 * Las columnas van calificadas a mano: interpolar `${orders.customerName}` acá
 * adentro las emite sin alias y la correlación termina comparando la
 * subconsulta consigo misma.
 */
function fromLatestOrder<T>(column: string): SQL<T> {
  return sql<T>`(
    SELECT o2.${sql.raw(`\`${column}\``)} FROM \`orders\` AS o2
    WHERE o2.\`customer_phone\` = \`orders\`.\`customer_phone\`
    ORDER BY o2.\`created_at\` DESC, o2.\`id\` DESC
    LIMIT 1
  )`;
}

/** `status IN ('pagado', ...)` con el mismo criterio de "cobrado" del resumen. */
function revenueStatusList(): SQL {
  return sql.join(
    REVENUE_STATUSES.map((status) => sql`${status}`),
    sql`, `
  );
}

export async function listCustomers(
  options: { search?: string; page?: number; perPage?: number } = {},
  executor?: Executor
): Promise<AdminCustomerPage> {
  const tx = executor ?? getDb();
  const perPage = Math.min(
    100,
    Math.max(1, options.perPage ?? CUSTOMERS_PER_PAGE)
  );
  const page = Math.max(1, options.page ?? 1);
  const where = phoneFilter(options.search);

  // Un cliente = un teléfono: la cuenta para paginar es de teléfonos
  // distintos, no de pedidos.
  const [{ total = 0 } = {}] = await tx
    .select({ total: countDistinct(orders.customerPhone) })
    .from(orders)
    .where(where);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);

  const cobrado = revenueStatusList();

  const rows = await tx
    .select({
      phone: orders.customerPhone,
      name: fromLatestOrder<string>("customer_name"),
      docNumber: fromLatestOrder<string | null>("doc_number"),
      orders: count(),
      // Sólo lo cobrado, con el criterio del resumen (`REVENUE_STATUSES`): dos
      // definiciones de "venta" en el mismo panel es un panel que se
      // contradice solo.
      paidOrders: sql<
        string | number
      >`SUM(CASE WHEN ${orders.status} IN (${cobrado}) THEN 1 ELSE 0 END)`,
      lifetimePyg: sql<
        string | number
      >`COALESCE(SUM(CASE WHEN ${orders.status} IN (${cobrado}) THEN ${orders.totalPyg} ELSE 0 END), 0)`,
      lastOrderAt: sql<Date | string>`MAX(${orders.createdAt})`,
    })
    .from(orders)
    .where(where)
    .groupBy(orders.customerPhone)
    .orderBy(desc(sql`MAX(${orders.createdAt})`))
    .limit(perPage)
    .offset((safePage - 1) * perPage);

  return {
    rows: rows.map((row) => ({
      phone: row.phone,
      name: String(row.name ?? ""),
      docNumber: row.docNumber === null ? null : String(row.docNumber),
      orders: Number(row.orders),
      paidOrders: Number(row.paidOrders),
      // La suma de un BIGINT vuelve como string desde mysql2 cuando no entra
      // exacta en un number: se normaliza acá, una sola vez.
      lifetimePyg: Number(row.lifetimePyg),
      lastOrderAt: databaseDate(row.lastOrderAt),
    })),
    total,
    page: safePage,
    perPage,
    totalPages,
  };
}
