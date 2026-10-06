import { operationTransaction } from "./operation-keys";
import { desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  orderItems,
  orderReturnItems,
  orderReturns,
  orders,
  users,
  type OrderStatus,
} from "@/db/schema";
import type { MessageKey, Params } from "@/i18n";
import { log, mensajeDe } from "@/lib/log";

import { applyStockAdjustment } from "./admin-products";
import { DomainError } from "./errors";
import type { Executor } from "./executor";
import { recordOrderEvent } from "./order-events";
import { getAvailability } from "./stock";
import { notifyBackInStock } from "./stock-alerts";

/**
 * Devoluciones de mercadería: qué volvió de un pedido, y si va de nuevo al
 * stock.
 *
 * **No mueve plata.** El reembolso ya existe (`refunds`, el formulario de
 * reembolso de la ficha del pedido, owner-only) y sigue siendo un paso
 * aparte: una devolución puede no tener reembolso —un cambio de talle— y un
 * reembolso puede no tener mercadería que vuelva. Este módulo no importa
 * nada del camino del dinero, a propósito.
 *
 * Las reglas, y por qué cada una:
 *
 * 1. **Una sola transacción con el pedido bloqueado** (`FOR UPDATE`, como
 *    `transitionOrder` y `editPendingOrder`). "Cuánto queda por devolver" se
 *    calcula sumando lo ya devuelto adentro de ese lock: dos devoluciones
 *    simultáneas del mismo pedido se hacen en fila y la segunda ve la
 *    primera. Sin el lock, dos clicks devuelven la misma remera dos veces y
 *    el stock sube de más.
 * 2. **Sólo pedidos que salieron**: `enviado`, `entregado` o `reembolsado`.
 *    Antes de eso la mercadería nunca dejó el local — lo que corresponde es
 *    editar o cancelar el pedido, no "devolver".
 * 3. **Reponer es un ajuste de stock de verdad**: la misma función que el
 *    ajuste manual (`applyStockAdjustment`), en esta transacción, con su fila
 *    en `stock_adjustments` y el motivo "Devolución del pedido …". El
 *    historial de inventario sigue siendo la historia completa. Y si la
 *    variante estaba agotada, sale el aviso de "volvió el stock" después del
 *    commit, igual que en `adjustStock`.
 * 4. **Queda en el historial del pedido** (`order_events`, `from = to`, con
 *    el prefijo `RETURN_REASON_PREFIX` que `reconcile` reconoce como "no es
 *    una transición").
 *
 * Append-only: no hay función para editar ni borrar una devolución.
 */

export class ReturnError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = "ReturnError";
  }
}

/** Desde dónde se puede registrar una devolución: la mercadería ya salió. */
export const RETURNABLE_STATUSES: readonly OrderStatus[] = [
  "enviado",
  "entregado",
  "reembolsado",
];

/** El prefijo del evento en `order_events`. `reconcile` lo usa para no leerlo como arista. */
export const RETURN_REASON_PREFIX = "Devolución: ";

export const RETURN_REASON_MIN = 3;
export const RETURN_REASON_MAX = 500;

export function canRegisterReturn(status: OrderStatus): boolean {
  return RETURNABLE_STATUSES.includes(status);
}

export type ReturnLineInput = {
  orderItemId: number;
  qty: number;
  /** `true` = vuelve a `on_hand`. Una prenda dañada vuelve, pero no se vende. */
  restock: boolean;
};

export type RegisterReturnInput = {
  operationKey?: string;
  orderId: number;
  reason: string;
  items: ReturnLineInput[];
  /** `admin:ana@tienda.py` — la verdad histórica, igual que en `order_events`. */
  actor: string;
  actorUserId?: number | null;
};

export type RegisterReturnResult = {
  returnId: number;
  orderNumber: string;
  /** Unidades que volvieron al stock, en total. */
  restockedUnits: number;
};

export async function registerReturn(
  input: RegisterReturnInput
): Promise<RegisterReturnResult> {
  const reason = input.reason.trim();
  if (reason.length < RETURN_REASON_MIN)
    throw new ReturnError("error.devolucion.sinMotivo");
  if (reason.length > RETURN_REASON_MAX) {
    throw new ReturnError("error.devolucion.motivoLargo", {
      maximo: RETURN_REASON_MAX,
    });
  }
  if (input.items.length === 0)
    throw new ReturnError("error.devolucion.sinItems");

  const vistos = new Set<number>();
  for (const linea of input.items) {
    if (!Number.isInteger(linea.qty) || linea.qty < 1)
      throw new ReturnError("error.devolucion.cantidad");
    if (vistos.has(linea.orderItemId))
      throw new ReturnError("error.devolucion.lineaRepetida");
    vistos.add(linea.orderItemId);
  }

  // Variantes que estaban agotadas antes de reponer: a ésas, después del
  // commit, les toca el aviso de "volvió el stock".
  const agotadasRepuestas: number[] = [];

  const { result, replay } = await operationTransaction(
    { scope: "return", key: input.operationKey, payload: input },
    async (tx) => {
      const pedido = (
        await tx
          .select({
            id: orders.id,
            status: orders.status,
            orderNumber: orders.orderNumber,
          })
          .from(orders)
          .where(eq(orders.id, input.orderId))
          .limit(1)
          .for("update")
      )[0];
      if (!pedido) throw new ReturnError("error.devolucion.pedidoNoExiste");
      if (!canRegisterReturn(pedido.status))
        throw new ReturnError("error.devolucion.estado");

      const lineas = await tx
        .select({
          id: orderItems.id,
          variantId: orderItems.variantId,
          qty: orderItems.qty,
          name: orderItems.nameSnapshot,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, pedido.id));
      const porId = new Map(lineas.map((linea) => [linea.id, linea]));

      // Lo ya devuelto, leído con el pedido bloqueado (regla 1). La resta se
      // hace en JS y no en SQL: `qty` es UNSIGNED y una resta negativa en MySQL
      // 8 explota (KNOWN-ISSUES.md).
      const yaDevuelto = await returnedByOrderItem(tx, pedido.id);

      for (const linea of input.items) {
        const item = porId.get(linea.orderItemId);
        if (!item) throw new ReturnError("error.devolucion.lineaAjena");
        const queda = item.qty - (yaDevuelto.get(item.id) ?? 0);
        if (linea.qty > queda) {
          throw new ReturnError("error.devolucion.demasiado", {
            producto: item.name,
            queda: Math.max(0, queda),
          });
        }
      }

      const [cabecera] = await tx.insert(orderReturns).values({
        orderId: pedido.id,
        reason,
        actor: input.actor,
        actorUserId: input.actorUserId ?? null,
      });
      const returnId = Number(cabecera.insertId);

      await tx.insert(orderReturnItems).values(
        input.items.map((linea) => ({
          returnId,
          orderItemId: linea.orderItemId,
          variantId: porId.get(linea.orderItemId)!.variantId,
          qty: linea.qty,
          restocked: linea.restock,
        }))
      );

      let restockedUnits = 0;
      for (const linea of input.items) {
        if (!linea.restock) continue;
        const item = porId.get(linea.orderItemId)!;

        const disponibleAntes = await getAvailability(item.variantId, tx);
        await applyStockAdjustment(tx, {
          variantId: item.variantId,
          delta: linea.qty,
          reason: `Devolución del pedido ${pedido.orderNumber}: ${reason}`,
          actor: input.actor,
          actorUserId: input.actorUserId ?? null,
        });
        if (
          disponibleAntes <= 0 &&
          !agotadasRepuestas.includes(item.variantId)
        ) {
          agotadasRepuestas.push(item.variantId);
        }
        restockedUnits += linea.qty;
      }

      await recordOrderEvent(
        {
          orderId: pedido.id,
          status: pedido.status,
          fromStatus: pedido.status,
          actor: input.actor,
          actorUserId: input.actorUserId ?? null,
          reason: returnEventReason(
            input.items.map((linea) => ({
              name: porId.get(linea.orderItemId)!.name,
              qty: linea.qty,
              restock: linea.restock,
            })),
            reason
          ),
        },
        { executor: tx }
      );

      return { returnId, orderNumber: pedido.orderNumber, restockedUnits };
    }
  );

  // Regla 3: igual que `adjustStock`, después del commit y sin `await`.
  for (const variantId of replay ? [] : agotadasRepuestas) {
    void notifyBackInStock(variantId).catch((error) => {
      log.error("notifyBackInStock rechazó", { error: mensajeDe(error) });
    });
  }

  return result;
}

/**
 * "Devolución: 2× Remera — M (repuesto al stock), 1× Short — S (no repuesto).
 * Motivo: talle equivocado". Cortado a los 500 de la columna.
 *
 * En castellano fijo y no del catálogo, como el resto de los motivos de
 * `order_events`: es un registro interno, no un texto de la vidriera.
 */
export function returnEventReason(
  lineas: { name: string; qty: number; restock: boolean }[],
  motivo: string
): string {
  const detalle = lineas
    .map(
      (linea) =>
        `${linea.qty}× ${linea.name} (${linea.restock ? "repuesto al stock" : "no repuesto"})`
    )
    .join(", ");
  return `${RETURN_REASON_PREFIX}${detalle}. Motivo: ${motivo}`.slice(0, 500);
}

/** Unidades ya devueltas por línea de un pedido. */
async function returnedByOrderItem(
  tx: Executor,
  orderId: number
): Promise<Map<number, number>> {
  const filas = await tx
    .select({
      orderItemId: orderReturnItems.orderItemId,
      n: sql<string>`SUM(${orderReturnItems.qty})`,
    })
    .from(orderReturnItems)
    .innerJoin(orderReturns, eq(orderReturnItems.returnId, orderReturns.id))
    .where(eq(orderReturns.orderId, orderId))
    .groupBy(orderReturnItems.orderItemId);
  return new Map(filas.map((fila) => [fila.orderItemId, Number(fila.n ?? 0)]));
}

export type ReturnableLine = {
  orderItemId: number;
  name: string;
  ordered: number;
  returned: number;
  /** Lo que todavía se puede devolver. Nunca negativo. */
  remaining: number;
};

/** Por línea del pedido: pedido, devuelto y lo que queda. Para el formulario. */
export async function returnableQuantities(
  orderId: number,
  executor?: Executor
): Promise<ReturnableLine[]> {
  const tx = executor ?? getDb();
  const lineas = await tx
    .select({
      id: orderItems.id,
      name: orderItems.nameSnapshot,
      qty: orderItems.qty,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.id);
  const yaDevuelto = await returnedByOrderItem(tx, orderId);

  return lineas.map((linea) => {
    const returned = yaDevuelto.get(linea.id) ?? 0;
    return {
      orderItemId: linea.id,
      name: linea.name,
      ordered: linea.qty,
      returned,
      remaining: Math.max(0, linea.qty - returned),
    };
  });
}

export type ReturnView = {
  id: number;
  orderId: number;
  reason: string;
  actor: string;
  /** El nombre de hoy de quien la cargó, o null si no fue una persona del panel. */
  actorName: string | null;
  createdAt: Date;
  items: { name: string; qty: number; restocked: boolean }[];
};

/** Las devoluciones de un pedido, de la más vieja a la más nueva. */
export async function listReturnsForOrder(
  orderId: number,
  executor?: Executor
): Promise<ReturnView[]> {
  const tx = executor ?? getDb();
  const cabeceras = await tx
    .select({
      id: orderReturns.id,
      orderId: orderReturns.orderId,
      reason: orderReturns.reason,
      actor: orderReturns.actor,
      actorName: users.name,
      actorEmail: users.email,
      createdAt: orderReturns.createdAt,
    })
    .from(orderReturns)
    .leftJoin(users, eq(orderReturns.actorUserId, users.id))
    .where(eq(orderReturns.orderId, orderId))
    .orderBy(orderReturns.createdAt, orderReturns.id);
  return withItems(tx, cabeceras);
}

export type RecentReturnView = ReturnView & { orderNumber: string };

/** Las últimas devoluciones de la tienda, para `/admin/devoluciones`. */
export async function listRecentReturns(
  limit = 100,
  executor?: Executor
): Promise<RecentReturnView[]> {
  const tx = executor ?? getDb();
  const cabeceras = await tx
    .select({
      id: orderReturns.id,
      orderId: orderReturns.orderId,
      orderNumber: orders.orderNumber,
      reason: orderReturns.reason,
      actor: orderReturns.actor,
      actorName: users.name,
      actorEmail: users.email,
      createdAt: orderReturns.createdAt,
    })
    .from(orderReturns)
    .innerJoin(orders, eq(orderReturns.orderId, orders.id))
    .leftJoin(users, eq(orderReturns.actorUserId, users.id))
    .orderBy(desc(orderReturns.createdAt), desc(orderReturns.id))
    .limit(limit);
  return withItems(tx, cabeceras);
}

async function withItems<
  T extends { id: number; actorName: string | null; actorEmail: string | null },
>(
  tx: Executor,
  cabeceras: T[]
): Promise<
  Array<Omit<T, "actorEmail"> & Pick<ReturnView, "items" | "actorName">>
> {
  if (cabeceras.length === 0) return [];

  const lineas = await tx
    .select({
      returnId: orderReturnItems.returnId,
      name: orderItems.nameSnapshot,
      qty: orderReturnItems.qty,
      restocked: orderReturnItems.restocked,
    })
    .from(orderReturnItems)
    .innerJoin(orderItems, eq(orderReturnItems.orderItemId, orderItems.id))
    .where(
      inArray(
        orderReturnItems.returnId,
        cabeceras.map((cabecera) => cabecera.id)
      )
    )
    .orderBy(orderReturnItems.id);

  const porDevolucion = new Map<number, ReturnView["items"]>();
  for (const linea of lineas) {
    const lista = porDevolucion.get(linea.returnId) ?? [];
    lista.push({
      name: linea.name,
      qty: linea.qty,
      restocked: linea.restocked,
    });
    porDevolucion.set(linea.returnId, lista);
  }

  return cabeceras.map(({ actorEmail, ...cabecera }) => ({
    ...cabecera,
    actorName: cabecera.actorName?.trim() || actorEmail || null,
    items: porDevolucion.get(cabecera.id) ?? [],
  }));
}
