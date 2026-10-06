import { databaseDate } from "@/lib/database-date";
import { operationTransaction } from "./operation-keys";
import { and, eq, sql } from "drizzle-orm";
import type { MessageKey, Params } from "@/i18n";

import { DomainError } from "./errors";

import { getDb } from "@/db";
import { orders, payments, refunds, type OrderStatus } from "@/db/schema";

import type { Executor } from "./executor";
import { recordOrderEvent } from "./order-events";
import { transitionOrder } from "./orders";

/**
 * Plata que entró y no tiene un pedido vivo detrás (ARCH.md §4.1).
 *
 * Es el otro extremo de la política del pago tardío. Cuando el aviso de
 * Pagopar llega después de que el cron venció el pedido, `transitionOrder`
 * intenta revivirlo re-asegurando el stock. Si la mercadería ya se vendió, el
 * pedido se queda en `vencido` **pero el pago igual queda registrado**: la fila
 * de `payments` en `paid` y el aviso crudo en `payment_events`. Perder ese
 * registro sería lo único imperdonable — es la prueba de que el comprador pagó.
 *
 * Registrado no alcanza: alguien tiene que devolver esa plata. Esta consulta
 * es lo que hace que el dueño lo vea, y por eso no se apoya en ninguna columna
 * nueva ni en ningún flag que haya que acordarse de escribir. Se deriva de los
 * datos: pago cobrado + pedido que no está en la cadena del cobro = caso a
 * mirar. Un flag se puede olvidar de poner; esto no.
 *
 * Todo el filtro corre en MySQL con enteros: acá no se hace aritmética de
 * dinero, sólo se lo transporta.
 */

/** Estados en los que el pago tiene sentido: la plata entró y el pedido vive. */
const SETTLED_STATUSES = [
  "pagado",
  "preparando",
  "enviado",
  "entregado",
  "reembolsado",
] as const;

export type UnmatchedPayment = {
  paymentId: number;
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  provider: string;
  providerRef: string;
  amountPyg: number;
  /**
   * Lo que ya se devolvió de este pago (O7). Sin esto, el formulario de
   * reembolso mostraba "queda por devolver: el total" después de cada recarga
   * de la pantalla, aunque el servidor tuviera bien la cuenta.
   */
  refundedPyg: number;
  /** Total del pedido, para comparar de un vistazo contra lo cobrado. */
  orderTotalPyg: number;
  paidAt: Date;
};

/**
 * Pagos en `paid` cuyo pedido no llegó nunca a la cadena del cobro.
 *
 * Lista vacía = no hay plata colgada. Cada fila es una devolución pendiente o,
 * en el mejor de los casos, un pedido que se puede revivir a mano si volvió a
 * haber stock.
 */
export async function findUnmatchedPayments(
  options: { limit?: number } = {},
  executor?: Executor
): Promise<UnmatchedPayment[]> {
  const tx = executor ?? getDb();
  const limit = options.limit ?? 50;

  const result = await tx.execute(sql`
    SELECT
      p.id            AS paymentId,
      o.id            AS orderId,
      o.order_number  AS orderNumber,
      o.status        AS orderStatus,
      p.provider      AS provider,
      p.provider_ref  AS providerRef,
      p.amount_pyg    AS amountPyg,
      p.refunded_pyg  AS refundedPyg,
      o.total_pyg     AS orderTotalPyg,
      p.updated_at    AS paidAt
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE p.status = 'paid'
      AND o.status NOT IN (${sql.join(
        SETTLED_STATUSES.map((status) => sql`${status}`),
        sql`, `
      )})
    ORDER BY p.updated_at DESC
    LIMIT ${limit}
  `);

  return rowsOf(result).map((row) => ({
    paymentId: Number(row.paymentId),
    orderId: Number(row.orderId),
    orderNumber: String(row.orderNumber),
    orderStatus: String(row.orderStatus),
    provider: String(row.provider),
    providerRef: String(row.providerRef),
    amountPyg: Number(row.amountPyg),
    refundedPyg: Number(row.refundedPyg ?? 0),
    orderTotalPyg: Number(row.orderTotalPyg),
    paidAt: databaseDate(row.paidAt as string | number | Date),
  }));
}

export type OrderPayment = {
  paymentId: number;
  provider: string;
  amountPyg: number;
  /** Acumulado ya devuelto. `amountPyg - refundedPyg` es lo que queda. */
  refundedPyg: number;
  paidAt: Date;
};

/**
 * El pago cobrado de un pedido, sea cual sea el estado del pedido.
 *
 * Es la consulta que le falta a la ficha del pedido para dibujar el formulario
 * de reembolso donde el caso de uso realmente vive: "la compradora se queda
 * con dos de tres remeras" pasa sobre un pedido `enviado` o `entregado`, y
 * `findUnmatchedPayments` los excluye a propósito (ahí la plata no está
 * colgada).
 *
 * `null` = este pedido no tiene un pago cobrado: contra entrega sin cobrar,
 * transferencia sin verificar, pedido todavía sin pagar. No es un error.
 *
 * Un pedido puede tener más de una fila en `payments` (un intento fallido y
 * después el bueno); se devuelve el `paid` más reciente, que es sobre el que
 * se devuelve plata.
 */
export async function getPaymentForOrder(
  orderId: number,
  executor?: Executor
): Promise<OrderPayment | null> {
  const tx = executor ?? getDb();

  const result = await tx.execute(sql`
    SELECT
      p.id           AS paymentId,
      p.provider     AS provider,
      p.amount_pyg   AS amountPyg,
      p.refunded_pyg AS refundedPyg,
      p.updated_at   AS paidAt
    FROM payments p
    WHERE p.order_id = ${orderId}
      AND p.status = 'paid'
    ORDER BY p.updated_at DESC, p.id DESC
    LIMIT 1
  `);

  const row = rowsOf(result)[0];
  if (!row) return null;

  return {
    paymentId: Number(row.paymentId),
    provider: String(row.provider),
    amountPyg: Number(row.amountPyg),
    refundedPyg: Number(row.refundedPyg ?? 0),
    paidAt: databaseDate(row.paidAt as string | number | Date),
  };
}

/** Sólo el conteo, para el resumen del panel. */
export async function countUnmatchedPayments(
  executor?: Executor
): Promise<number> {
  const rows = await findUnmatchedPayments({ limit: 1000 }, executor);
  return rows.length;
}

/* ---------------------------------------------------------------------------
 * Las dos acciones que la lista implica
 *
 * Mostrar la plata colgada era la mitad del trabajo. La otra mitad es poder
 * hacer algo con ella sin abrir la consola de MySQL: reintentar la
 * recuperación (si volvió a haber stock) o marcarla devuelta.
 *
 * Las dos releen el estado con `SELECT ... FOR UPDATE` en vez de confiar en el
 * id que vino del formulario. La lista se renderizó hace un minuto y desde
 * entonces pudo pasar cualquier cosa: el otro dueño ya devolvió esa plata, el
 * cron movió el pedido, entró una venta que se llevó la última unidad. Decidir
 * sobre lo que decía la pantalla es decidir sobre datos viejos.
 *
 * Las dos son idempotentes: el segundo click no hace nada y no es un error.
 * ------------------------------------------------------------------------- */

/** Algo del pedido o del pago impide la acción. El mensaje lo lee el dueño. */
export class PaymentRecoveryError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = "PaymentRecoveryError";
  }
}

export type RecoveryResult = {
  paymentId: number;
  orderId: number;
  orderNumber: string;
  orderStatus: OrderStatus;
  /** `false` si ya estaba así: el segundo click de un doble click. */
  changed: boolean;
  /** Devolución sobre un pedido que ya estaba `cancelado`: no se movió nada. */
  orderAlreadyClosed?: boolean;
  /** El acumulado devuelto del pago después de esta operación (O7). */
  refundedPyg?: number;
  /** `true` cuando este movimiento completó el total del pago (O7). */
  fullyRefunded?: boolean;
};

/**
 * Reintenta revivir el pedido de un pago que quedó colgado.
 *
 * El caso que arregla: el pago entró tarde, el pedido estaba `vencido` y la
 * mercadería no estaba. Días después el comercio repone stock y el pedido se
 * puede cumplir. Esto es ese botón.
 *
 * No hay ningún `UPDATE orders SET status` acá: el estado lo mueve
 * `transitionOrder`, que vuelve a validar la arista y —lo importante— vuelve a
 * asegurar el stock antes de descontar (ARCH.md §4.1). Si la mercadería sigue
 * sin estar, tira `StockUnavailableError` y el pedido no se mueve: el
 * reintento puede fallar tantas veces como haga falta sin ensuciar nada.
 */
export async function retryOrderRevival(input: {
  paymentId: number;
  actor: string;
  /**
   * `users.id` de quien lo hizo (PR D). Opcional por el mismo motivo que en
   * `TransitionOptions`: hay caminos legítimos sin persona detrás.
   */
  actorUserId?: number | null;
}): Promise<RecoveryResult> {
  return getDb().transaction(async (tx) => {
    const { payment, order } = await lockPaymentAndOrder(tx, input.paymentId);

    if (payment.status === "refunded") {
      throw new PaymentRecoveryError("adminError.pago.yaDevuelto");
    }
    if (payment.status !== "paid") {
      throw new PaymentRecoveryError("adminError.pago.noAcreditado");
    }

    // Otro dueño ya lo revivió desde la otra pestaña. No es un error: el
    // resultado que se pedía ya está.
    if (
      SETTLED_STATUSES.includes(
        order.status as (typeof SETTLED_STATUSES)[number]
      )
    ) {
      return {
        paymentId: payment.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        changed: false,
      };
    }

    // `cancelado` no revive (ARCH.md §4.1, regla 4): lo canceló una persona a
    // propósito y el software no la contradice. La máquina de estados ya lo
    // impide —`cancelado` no tiene aristas de salida— pero el mensaje que sale
    // de ahí habla de transiciones, y el que lee esto es el dueño.
    if (order.status === "cancelado") {
      throw new PaymentRecoveryError("adminError.pago.pedidoCancelado");
    }

    const result = await transitionOrder(
      order.id,
      "pagado",
      input.actor,
      "reintento de recuperación del pago tardío desde el panel",
      { executor: tx, actorUserId: input.actorUserId ?? null }
    );

    return {
      paymentId: payment.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderStatus: "pagado" as OrderStatus,
      changed: result.changed,
    };
  });
}

/** Mínimo del motivo de la devolución. El mismo criterio que el rechazo. */
export const REFUND_MIN_REASON = 5;

/**
 * El prefijo del motivo que deja un reembolso **parcial** en `order_events`.
 *
 * Es una constante y no un literal suelto porque `reconcile` lo lee: el
 * control de aristas imposibles tiene que reconocer estas filas —que a
 * propósito tienen `from = to`— como legítimas en vez de reportarlas.
 */
export const PARTIAL_REFUND_REASON_PREFIX = "devolución parcial ₲";

/**
 * Marca el pago como devuelto y cierra el pedido.
 *
 * El ledger, `payments.status` a `refunded` y el pedido a `cancelado` o
 * `reembolsado` van juntos, con el motivo en `order_events`. Si se
 * escribiera sólo la primera, la plata desaparecería de esta lista con el
 * pedido todavía esperando; si se escribiera sólo la segunda, la devolución no
 * quedaría registrada en ningún lado.
 *
 * Esto **no le devuelve la plata a nadie**: la transferencia la hace el dueño
 * desde su banco. Acá se anota que la hizo, que es lo que saca la fila de la
 * lista de pendientes.
 */
export async function refundPayment(input: {
  operationKey?: string;
  paymentId: number;
  reason: string;
  actor: string;
  /**
   * Cuánto devolver, en guaraníes enteros. **Ausente = todo lo que queda**,
   * que es el reembolso total de siempre.
   *
   * Es sólo una intención: el servidor relee `amount_pyg` y `refunded_pyg` con
   * la fila bloqueada y verifica contra esos números. La pantalla que mandó
   * este monto se dibujó hace un minuto y desde entonces otro dueño pudo haber
   * devuelto la mitad.
   */
  amountPyg?: number;
  /** Habilita el total sobre un pedido cobrado desde su ficha. Default: false. */
  allowSettled?: boolean;
  /**
   * `users.id` de quien lo hizo (PR D). Opcional por el mismo motivo que en
   * `TransitionOptions`: hay caminos legítimos sin persona detrás.
   */
  actorUserId?: number | null;
}): Promise<RecoveryResult> {
  const reason = input.reason.trim();
  if (reason.length < REFUND_MIN_REASON) {
    throw new PaymentRecoveryError("adminError.pago.sinMotivo");
  }

  // El monto llega del formulario y no se usa para nada más que compararlo:
  // el servidor relee `amount_pyg` y `refunded_pyg` con la fila bloqueada y
  // decide con **esos** números. El navegador nunca decide plata.
  if (input.amountPyg !== undefined) {
    if (!Number.isInteger(input.amountPyg) || input.amountPyg <= 0) {
      throw new PaymentRecoveryError("adminError.pago.montoInvalido");
    }
  }

  const { result: outcome } = await operationTransaction<RecoveryResult>(
    { scope: "refund", key: input.operationKey, payload: input },
    async (tx) => {
      const { payment, order } = await lockPaymentAndOrder(tx, input.paymentId);

      // Segundo click de una devolución **total**: ya estaba devuelto entero. Se
      // contesta lo mismo que la primera vez, sin escribir nada.
      //
      // Ojo con el borde: si vino un monto parcial y el pago ya está `refunded`,
      // esto también corta — y está bien, porque no queda nada por devolver. El
      // chequeo del acumulado de más abajo diría lo mismo.
      if (payment.status === "refunded") {
        return {
          paymentId: payment.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderStatus: order.status,
          changed: false,
        };
      }
      if (payment.status !== "paid") {
        throw new PaymentRecoveryError("adminError.pago.nadaQueDevolver");
      }

      const yaDevuelto = payment.refundedPyg ?? 0;
      const disponible = payment.amountPyg - yaDevuelto;
      // Sin monto = devolución total, que es el comportamiento de siempre: lo
      // que queda por devolver, no `amount_pyg` a secas. Con parciales previos
      // son cosas distintas, y devolver el total dos veces sería devolver de más.
      const monto = input.amountPyg ?? disponible;

      if (monto > disponible) {
        throw new PaymentRecoveryError("adminError.pago.montoExcede", {
          disponible: String(disponible),
        });
      }

      const total = monto === disponible;

      // La lista de pagos colgados conserva la protección contra un pedido que
      // revivió. Su ficha habilita explícitamente el total con allowSettled.
      // Los parciales siguen sin mover el estado del pedido.
      const settled = SETTLED_STATUSES.includes(
        order.status as (typeof SETTLED_STATUSES)[number]
      );
      if (total && settled && !input.allowSettled) {
        throw new PaymentRecoveryError("adminError.pago.pedidoRevivio", {
          estado: order.status,
        });
      }

      // El ledger primero: es la fila que explica la plata, y las dos escrituras
      // van en la misma transacción, así que el orden sólo importa para leerlo.
      await tx.insert(refunds).values({
        paymentId: payment.id,
        amountPyg: monto,
        reason: reason.slice(0, 500),
        actor: input.actor,
        actorUserId: input.actorUserId ?? null,
      });

      await tx
        .update(payments)
        .set({
          refundedPyg: yaDevuelto + monto,
          // `refunded` **sólo** al llegar al total: un pago devuelto a medias
          // sigue siendo un pago cobrado, y marcarlo antes lo sacaría de los
          // controles de `reconcile` que verifican que la plata que entró esté
          // registrada.
          ...(total ? { status: "refunded" as const } : {}),
        })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "paid")));

      if (!total) {
        // Un parcial no mueve el estado del pedido, pero **tiene que dejar
        // rastro en su historia**: sin esto, la única huella de que salió plata
        // de este pedido estaría en `refunds`, que la ficha del pedido no lee.
        // `from = to = estado actual` es lo que `recordOrderEvent` escribe para
        // "pasó algo que no es una transición".
        await recordOrderEvent(
          {
            orderId: order.id,
            status: order.status,
            // `from` y `to` en el **mismo** estado, explícito. El default de
            // `recordOrderEvent` es `fromStatus: null`, que significa otra cosa
            // —"el pedido nació"— y `reconcile` lo reporta como arista
            // imposible en cuanto el destino no es `pendiente_pago`.
            fromStatus: order.status,
            actor: input.actor,
            actorUserId: input.actorUserId ?? null,
            reason: `${PARTIAL_REFUND_REASON_PREFIX}${monto}: ${reason}`.slice(
              0,
              500
            ),
          },
          { executor: tx }
        );

        return {
          paymentId: payment.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderStatus: order.status,
          changed: true,
          refundedPyg: yaDevuelto + monto,
          fullyRefunded: false,
        };
      }

      // Sólo el ledger lleva un pedido cobrado a reembolsado. Los pagos colgados
      // siguen cerrándose en cancelado; si ya estaba cancelado no se pisa su
      // motivo original. La devolución no repone mercadería automáticamente.
      const destination = settled ? "reembolsado" : "cancelado";
      const result = await transitionOrder(
        order.id,
        destination,
        input.actor,
        `pago devuelto: ${reason}`.slice(0, 500),
        { executor: tx, actorUserId: input.actorUserId ?? null }
      );

      return {
        paymentId: payment.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderStatus: destination,
        // `true` sin mirar `result.changed`: el pago pasó a `refunded` en esta
        // misma corrida, aunque el pedido ya estuviera cancelado de antes.
        changed: true,
        orderAlreadyClosed: !result.changed,
        refundedPyg: payment.amountPyg,
        fullyRefunded: true,
      };
    }
  );
  return outcome;
}

/**
 * Relee el pago y su pedido con el candado tomado.
 *
 * El orden importa: primero el pago, después el pedido — el mismo que toma
 * `transitionOrder` a continuación. Dos acciones simultáneas sobre la misma
 * fila se ordenan en vez de cruzarse.
 */
async function lockPaymentAndOrder(tx: Executor, paymentId: number) {
  const payment = (
    await tx
      .select({
        id: payments.id,
        orderId: payments.orderId,
        status: payments.status,
        amountPyg: payments.amountPyg,
        refundedPyg: payments.refundedPyg,
      })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for("update")
  )[0];

  if (!payment) {
    throw new PaymentRecoveryError("adminError.pago.noEncontrado");
  }

  const order = (
    await tx
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, payment.orderId))
      .for("update")
  )[0];

  if (!order) {
    throw new PaymentRecoveryError("adminError.pago.pedidoNoExiste");
  }

  return { payment, order };
}

/** mysql2 devuelve `[rows, fields]`; drizzle a veces pasa las filas peladas. */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const candidate = Array.isArray(result) ? result[0] : result;
  return Array.isArray(candidate)
    ? (candidate as Array<Record<string, unknown>>)
    : [];
}
