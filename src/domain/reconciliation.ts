import { sql } from "drizzle-orm";

import { getDb } from "@/db";

import type { Executor } from "./executor";
import { ORDER_TRANSITIONS } from "./orders";
import { NOTICE_REASON_PREFIX } from "./order-events";
import { EDIT_ORDER_REASON_PREFIX } from "./edit-order";
import { RETURN_REASON_PREFIX } from "./returns";
import { PARTIAL_REFUND_REASON_PREFIX } from "./payment-recovery";

/**
 * Reconciliación (PLAN.md 4.10).
 *
 * Dos capas. La primera verifica las tres identidades aritméticas que sostienen
 * el dinero de la tienda (ARCH.md §2 "Money invariants"):
 *
 *   1. `subtotal_pyg = Σ(order_items.line_total_pyg)`
 *   2. `total_pyg = subtotal_pyg − discount_pyg + shipping_pyg`
 *   3. `line_total_pyg = unit_price_pyg × qty` en cada línea
 *
 * El descuento entró en la identidad 2 con los cupones (PR G): es plata que
 * sale del subtotal, así que tiene que cuadrar como todo lo demás. Un cupón que
 * descuente sin dejar rastro en `discount_pyg` cae en este control.
 *
 * La segunda —los controles cruzados, más abajo— verifica que las tablas
 * cuenten todas la misma historia: pedidos cobrados sin pago registrado, pagos
 * registrados sin pedido movido, montos que no coinciden, comprobantes
 * aprobados que no movieron nada y aristas que la máquina de estados no
 * permite. La aritmética mira una fila; esto mira las costuras.
 *
 * Todo pasa en MySQL con enteros. Si esto se hiciera en JS trayendo las filas,
 * la propia suma sería el paso que introduce el error que estamos buscando.
 *
 * Un desvío acá no es un redondeo: significa que algo escribió un total sin
 * pasar por `createOrder`, y hay que ir a buscar qué.
 */

export type ReconciliationRow = {
  orderId: number;
  orderNumber: string;
  status: string;
  storedSubtotalPyg: number;
  itemsSubtotalPyg: number;
  discountPyg: number;
  shippingPyg: number;
  storedTotalPyg: number;
  expectedTotalPyg: number;
  subtotalDiffPyg: number;
  totalDiffPyg: number;
};

/**
 * Pedidos cuyos totales no cierran. Lista vacía = todo cuadra.
 *
 * El LEFT JOIN es a propósito: un pedido sin ítems suma 0 y sale reportado en
 * vez de desaparecer del control, que es justo el caso más raro y más grave.
 */
export async function findTotalMismatches(
  options: { limit?: number } = {},
  executor?: Executor,
): Promise<ReconciliationRow[]> {
  const tx = executor ?? getDb();
  const limit = options.limit ?? 100;

  const result = await tx.execute(sql`
    SELECT
      o.id                                        AS orderId,
      o.order_number                              AS orderNumber,
      o.status                                    AS status,
      o.subtotal_pyg                              AS storedSubtotalPyg,
      COALESCE(i.items_subtotal, 0)               AS itemsSubtotalPyg,
      o.discount_pyg                              AS discountPyg,
      o.shipping_pyg                              AS shippingPyg,
      o.total_pyg                                 AS storedTotalPyg,
      -- CAST a SIGNED antes de restar. Las columnas son BIGINT UNSIGNED, y
      -- restar un descuento corrupto (mayor que el subtotal) no da negativo:
      -- aborta la consulta entera con ER_DATA_OUT_OF_RANGE. Sin el cast, la
      -- reconciliación se cae con un error de MySQL justo en el pedido que
      -- existe para encontrar.
      (CAST(o.subtotal_pyg AS SIGNED) - CAST(o.discount_pyg AS SIGNED)
        + CAST(o.shipping_pyg AS SIGNED))         AS expectedTotalPyg,
      CAST(o.subtotal_pyg AS SIGNED) - CAST(COALESCE(i.items_subtotal, 0) AS SIGNED)
                                                  AS subtotalDiffPyg,
      CAST(o.total_pyg AS SIGNED)
        - (CAST(o.subtotal_pyg AS SIGNED) - CAST(o.discount_pyg AS SIGNED)
           + CAST(o.shipping_pyg AS SIGNED))
                                                  AS totalDiffPyg
    FROM orders o
    LEFT JOIN (
      SELECT order_id, SUM(line_total_pyg) AS items_subtotal
      FROM order_items
      GROUP BY order_id
    ) i ON i.order_id = o.id
    WHERE o.subtotal_pyg <> COALESCE(i.items_subtotal, 0)
       OR CAST(o.total_pyg AS SIGNED) <> CAST(o.subtotal_pyg AS SIGNED)
            - CAST(o.discount_pyg AS SIGNED) + CAST(o.shipping_pyg AS SIGNED)
    ORDER BY o.id DESC
    LIMIT ${limit}
  `);

  return rowsOf(result).map((row) => ({
    orderId: Number(row.orderId),
    orderNumber: String(row.orderNumber),
    status: String(row.status),
    storedSubtotalPyg: Number(row.storedSubtotalPyg),
    itemsSubtotalPyg: Number(row.itemsSubtotalPyg),
    discountPyg: Number(row.discountPyg),
    shippingPyg: Number(row.shippingPyg),
    storedTotalPyg: Number(row.storedTotalPyg),
    expectedTotalPyg: Number(row.expectedTotalPyg),
    subtotalDiffPyg: Number(row.subtotalDiffPyg),
    totalDiffPyg: Number(row.totalDiffPyg),
  }));
}

export type LineMismatch = {
  orderItemId: number;
  orderNumber: string;
  skuSnapshot: string;
  unitPricePyg: number;
  qty: number;
  storedLineTotalPyg: number;
  expectedLineTotalPyg: number;
};

/** Líneas donde `line_total_pyg ≠ unit_price_pyg × qty`. */
export async function findLineMismatches(
  options: { limit?: number } = {},
  executor?: Executor,
): Promise<LineMismatch[]> {
  const tx = executor ?? getDb();
  const limit = options.limit ?? 100;

  const result = await tx.execute(sql`
    SELECT
      oi.id                       AS orderItemId,
      o.order_number              AS orderNumber,
      oi.sku_snapshot             AS skuSnapshot,
      oi.unit_price_pyg           AS unitPricePyg,
      oi.qty                      AS qty,
      oi.line_total_pyg           AS storedLineTotalPyg,
      oi.unit_price_pyg * oi.qty  AS expectedLineTotalPyg
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.line_total_pyg <> oi.unit_price_pyg * oi.qty
    ORDER BY oi.id DESC
    LIMIT ${limit}
  `);

  return rowsOf(result).map((row) => ({
    orderItemId: Number(row.orderItemId),
    orderNumber: String(row.orderNumber),
    skuSnapshot: String(row.skuSnapshot),
    unitPricePyg: Number(row.unitPricePyg),
    qty: Number(row.qty),
    storedLineTotalPyg: Number(row.storedLineTotalPyg),
    expectedLineTotalPyg: Number(row.expectedLineTotalPyg),
  }));
}

/* ---------------------------------------------------------------------------
 * Invariantes entre tablas (v2)
 *
 * La aritmética de arriba mira una sola fila por vez y no ve el problema más
 * caro: que dos tablas cuenten historias distintas de la misma plata. Un
 * pedido `pagado` sin pago registrado y un pago registrado sin pedido movido
 * son el mismo bug visto desde cada punta, y ninguna de las tres identidades
 * anteriores lo detecta.
 *
 * Todo corre en MySQL. Traer las filas y compararlas en JS convertiría cada
 * `BIGINT` en un `number` de coma flotante justo en el paso que existe para
 * encontrar errores de plata.
 * ------------------------------------------------------------------------- */

/** Estados en los que la plata ya entró (o volvió) y el pedido está cerrado. */
const SETTLED = ["pagado", "preparando", "enviado", "entregado", "reembolsado"] as const;

/** Qué invariante se rompió. El id es estable: sirve para grepear en un log. */
export type CrossCheckKind =
  | "pedido_cobrado_sin_pago"
  | "pago_sin_transicion"
  | "monto_del_pago_distinto"
  | "comprobante_aprobado_sin_movimiento"
  | "arista_imposible"
  | "descuento_sin_cupon"
  | "descuento_mayor_al_subtotal"
  | "usos_del_cupon_no_cuadran"
  | "devoluciones_no_cuadran";

export type CrossCheckFinding = {
  kind: CrossCheckKind;
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  /** Frase lista para imprimir, ya con los números adentro. */
  detail: string;
};

const CROSS_CHECK_LIMIT = 100;

/**
 * Pedido cobrado sin fila de pago, por cualquier método.
 *
 * Estuvo acotado a `tarjeta` mientras Pagopar era lo único que escribía en
 * `payments`: sin ese filtro, cada transferencia aprobada y cada contra
 * entrega —ventas legítimas— salían reportadas, y un control que grita siempre
 * es un control que nadie mira. Ahora los dos caminos manuales registran su
 * pago en la misma transacción que cobra el pedido
 * (`recordManualPayment`, TASKS.md §27), así que el filtro dejó de tapar un
 * hueco y pasaría a tapar el control: la invariante es "pedido cobrado ⇒ pago
 * registrado", sin excepciones por método.
 *
 * `paid` o `refunded`: lo que se verifica es que la plata haya quedado
 * anotada, y devolverla no borra que entró. Un pedido `reembolsado` con su
 * pago en `refunded` está bien, no le falta el registro.
 */
export async function findOrdersPaidWithoutPayment(
  executor?: Executor,
): Promise<CrossCheckFinding[]> {
  const tx = executor ?? getDb();

  const result = await tx.execute(sql`
    SELECT
      o.id             AS orderId,
      o.order_number   AS orderNumber,
      o.status         AS orderStatus,
      o.payment_method AS paymentMethod
    FROM orders o
    WHERE o.status IN (${statusList(SETTLED)})
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.order_id = o.id AND p.status IN ('paid', 'refunded')
      )
    ORDER BY o.id DESC
    LIMIT ${CROSS_CHECK_LIMIT}
  `);

  return rowsOf(result).map((row) => ({
    kind: "pedido_cobrado_sin_pago" as const,
    ...identity(row),
    detail:
      `el pedido está cobrado (${row.paymentMethod}) pero no hay ninguna fila de pago ` +
      `acreditada`,
  }));
}

/**
 * Pago acreditado cuyo pedido nunca pasó por `pagado`.
 *
 * Se mira `order_events` y no `orders.status`: el estado actual puede haber
 * seguido avanzando (`enviado`, `entregado`) o retrocedido a `reembolsado`, y
 * lo que se quiere saber es si la transición **ocurrió alguna vez**. El log de
 * auditoría es lo único que puede contestar eso.
 */
export async function findPaymentsWithoutTransition(
  executor?: Executor,
): Promise<CrossCheckFinding[]> {
  const tx = executor ?? getDb();

  const result = await tx.execute(sql`
    SELECT
      o.id           AS orderId,
      o.order_number AS orderNumber,
      o.status       AS orderStatus,
      p.provider     AS provider,
      p.amount_pyg   AS amountPyg
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE p.status = 'paid'
      AND NOT EXISTS (
        SELECT 1 FROM order_events e
        WHERE e.order_id = o.id AND e.to_status = 'pagado'
      )
    ORDER BY p.id DESC
    LIMIT ${CROSS_CHECK_LIMIT}
  `);

  return rowsOf(result).map((row) => ({
    kind: "pago_sin_transicion" as const,
    ...identity(row),
    detail:
      `hay un pago acreditado de ${row.provider} por ${row.amountPyg} ₲ y el pedido ` +
      `nunca pasó por "pagado"`,
  }));
}

/**
 * `payments.amount_pyg ≠ orders.total_pyg`.
 *
 * La comparación es de enteros y la hace MySQL. El webhook ya rechaza el aviso
 * con monto distinto, así que una fila acá significa que el descuadre entró por
 * otro lado: un total editado después de cobrar, o una fila escrita a mano.
 */
export async function findPaymentAmountMismatches(
  executor?: Executor,
): Promise<CrossCheckFinding[]> {
  const tx = executor ?? getDb();

  const result = await tx.execute(sql`
    SELECT
      o.id           AS orderId,
      o.order_number AS orderNumber,
      o.status       AS orderStatus,
      p.provider     AS provider,
      p.amount_pyg   AS amountPyg,
      o.total_pyg    AS totalPyg,
      CAST(p.amount_pyg AS SIGNED) - CAST(o.total_pyg AS SIGNED) AS diffPyg
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE p.status IN ('paid', 'refunded')
      AND p.amount_pyg <> o.total_pyg
    ORDER BY p.id DESC
    LIMIT ${CROSS_CHECK_LIMIT}
  `);

  return rowsOf(result).map((row) => ({
    kind: "monto_del_pago_distinto" as const,
    ...identity(row),
    detail:
      `el pago de ${row.provider} dice ${row.amountPyg} ₲ y el pedido ${row.totalPyg} ₲ ` +
      `(diferencia ${row.diffPyg})`,
  }));
}

/**
 * Comprobante aprobado y pedido que no se movió.
 *
 * Aprobar es lo que dispara `transitionOrder(→ pagado)`; las dos escrituras
 * viajan en la misma transacción. Una fila acá significa que esa transacción no
 * es tan atómica como se cree, o que alguien tocó `receipts.review` a mano.
 */
export async function findApprovedReceiptsWithoutMove(
  executor?: Executor,
): Promise<CrossCheckFinding[]> {
  const tx = executor ?? getDb();

  const result = await tx.execute(sql`
    SELECT
      o.id           AS orderId,
      o.order_number AS orderNumber,
      o.status       AS orderStatus,
      r.id           AS receiptId
    FROM receipts r
    JOIN orders o ON o.id = r.order_id
    WHERE r.review = 'approved'
      AND o.status NOT IN (${statusList(SETTLED)})
    ORDER BY r.id DESC
    LIMIT ${CROSS_CHECK_LIMIT}
  `);

  return rowsOf(result).map((row) => ({
    kind: "comprobante_aprobado_sin_movimiento" as const,
    ...identity(row),
    detail: `el comprobante ${row.receiptId} está aprobado y el pedido quedó en "${row.orderStatus}"`,
  }));
}

/**
 * Descuento sin cupón que lo explique, y cupón sin descuento.
 *
 * Las dos direcciones son la misma pregunta: **¿de dónde salió esta plata que
 * no se cobró?** Un `discount_pyg > 0` con `coupon_code` en NULL es un pedido
 * al que alguien le bajó el total sin dejar rastro de por qué. Al revés —cupón
 * anotado y descuento en cero— es más raro y también hay que mirarlo: o el
 * cupón no descontaba nada, o el descuento se perdió al escribir.
 *
 * Se mira contra `coupon_code` (el snapshot) y no contra `coupon_id`, porque
 * la FK es `ON DELETE SET NULL`: borrar el cupón no puede convertir pedidos
 * viejos y correctos en hallazgos de reconciliación.
 */
export async function findDiscountsWithoutCoupon(
  executor?: Executor,
): Promise<CrossCheckFinding[]> {
  const tx = executor ?? getDb();

  const result = await tx.execute(sql`
    SELECT
      o.id            AS orderId,
      o.order_number  AS orderNumber,
      o.status        AS orderStatus,
      o.discount_pyg  AS discountPyg,
      o.coupon_code   AS couponCode
    FROM orders o
    WHERE (o.discount_pyg > 0 AND o.coupon_code IS NULL)
       OR (o.discount_pyg = 0 AND o.coupon_code IS NOT NULL)
    ORDER BY o.id DESC
    LIMIT ${CROSS_CHECK_LIMIT}
  `);

  return rowsOf(result).map((row) => ({
    kind: "descuento_sin_cupon" as const,
    ...identity(row),
    detail:
      Number(row.discountPyg) > 0
        ? `descuenta ${row.discountPyg} ₲ y no dice con qué cupón`
        : `dice cupón "${row.couponCode}" y no descontó nada`,
  }));
}

/**
 * Descuento más grande que el subtotal.
 *
 * `computeDiscount` lo topea al subtotal, así que una fila acá significa que
 * alguien escribió un total sin pasar por `computeOrderTotals` — que es
 * exactamente lo que `pnpm reconcile` existe para encontrar. El daño concreto
 * sería un pedido cuyo descuento se está comiendo el envío.
 */
export async function findDiscountsOverSubtotal(
  executor?: Executor,
): Promise<CrossCheckFinding[]> {
  const tx = executor ?? getDb();

  const result = await tx.execute(sql`
    SELECT
      o.id            AS orderId,
      o.order_number  AS orderNumber,
      o.status        AS orderStatus,
      o.discount_pyg  AS discountPyg,
      o.subtotal_pyg  AS subtotalPyg
    FROM orders o
    WHERE o.discount_pyg > o.subtotal_pyg
    ORDER BY o.id DESC
    LIMIT ${CROSS_CHECK_LIMIT}
  `);

  return rowsOf(result).map((row) => ({
    kind: "descuento_mayor_al_subtotal" as const,
    ...identity(row),
    detail: `descuenta ${row.discountPyg} ₲ sobre un subtotal de ${row.subtotalPyg} ₲`,
  }));
}

/**
 * El contador de usos del cupón contra los pedidos que lo usaron.
 *
 * `coupons.times_used` es lo que decide si un cupón sigue disponible, y se
 * incrementa adentro de la transacción que crea el pedido. Si se despega de la
 * cantidad de pedidos que lo tienen, el tope de usos deja de significar lo que
 * dice: de menos, el cupón se puede seguir usando después de agotado; de más,
 * se agota antes de tiempo.
 *
 * Tolera `times_used` **mayor** sólo por los pedidos borrados, que hoy no
 * existen — no hay borrado de pedidos en la app. O sea que cualquier desvío se
 * reporta.
 */
export async function findCouponUsageMismatches(
  executor?: Executor,
): Promise<CrossCheckFinding[]> {
  const tx = executor ?? getDb();

  const result = await tx.execute(sql`
    SELECT
      c.id                          AS couponId,
      c.code                        AS code,
      c.times_used                  AS timesUsed,
      COALESCE(u.n, 0)              AS actualUses
    FROM coupons c
    LEFT JOIN (
      SELECT coupon_id, COUNT(*) AS n FROM orders WHERE coupon_id IS NOT NULL GROUP BY coupon_id
    ) u ON u.coupon_id = c.id
    WHERE c.times_used <> COALESCE(u.n, 0)
    ORDER BY c.id DESC
    LIMIT ${CROSS_CHECK_LIMIT}
  `);

  // Este control mira cupones, no pedidos: las tres columnas de identidad que
  // el resto trae no aplican, así que se completan con lo que sí identifica al
  // hallazgo. El `detail` es lo que se lee en la salida del script.
  return rowsOf(result).map((row) => ({
    kind: "usos_del_cupon_no_cuadran" as const,
    orderId: 0,
    orderNumber: `cupón ${row.code}`,
    orderStatus: "—",
    detail: `el cupón "${row.code}" dice ${row.timesUsed} usos y hay ${row.actualUses} pedidos con él`,
  }));
}

/**
 * Filas de `order_events` con una arista que la máquina de estados no permite.
 *
 * La lista blanca se arma acá con `ORDER_TRANSITIONS`, la misma constante que
 * usa `transitionOrder`: si mañana se agrega una arista, este control la acepta
 * sola. Escribirla a mano en el SQL sería garantizar que las dos versiones se
 * separen.
 *
 * Una fila acá es la más grave de todas: significa que algo movió un pedido sin
 * pasar por `transitionOrder`, que es la premisa sobre la que se apoya todo lo
 * demás (ARCH.md §3).
 */
export async function findImpossibleEdges(executor?: Executor): Promise<CrossCheckFinding[]> {
  const tx = executor ?? getDb();

  const allowed = Object.entries(ORDER_TRANSITIONS).flatMap(([from, targets]) =>
    targets.map((to) => sql`(${from}, ${to})`),
  );

  // Fuera del template: un literal anidado adentro de un `${}` de `sql` no
  // compila, y el patrón conviene armarlo una sola vez igual.
  const parcialLike = `${PARTIAL_REFUND_REASON_PREFIX}%`;
  const edicionLike = `${EDIT_ORDER_REASON_PREFIX}%`;
  const avisoLike = `${NOTICE_REASON_PREFIX}%`;
  const devolucionLike = `${RETURN_REASON_PREFIX}%`;

  const result = await tx.execute(sql`
    SELECT
      o.id            AS orderId,
      o.order_number  AS orderNumber,
      o.status        AS orderStatus,
      e.id            AS eventId,
      e.from_status   AS fromStatus,
      e.to_status     AS toStatus,
      e.actor         AS actor
    FROM order_events e
    JOIN orders o ON o.id = e.order_id
    WHERE CASE
      -- Los avisos no son transiciones: hoy guardan from = to; las filas
      -- históricas guardaban from NULL. Ambas formas se reconocen por el motivo.
      WHEN e.from_status = e.to_status AND e.reason LIKE ${avisoLike} THEN FALSE
      WHEN e.from_status IS NULL AND e.reason LIKE ${avisoLike} THEN FALSE
      -- from_status IS NULL es legítimo exactamente una vez por pedido: la
      -- fila que escribe createOrder al nacer. Con cualquier otro destino es
      -- un pedido que apareció ya cobrado. El CASE es necesario además porque
      -- un NULL adentro del row constructor vuelve la comparación NULL, o sea
      -- "no sospechoso", que es justo lo contrario de lo que queremos.
      WHEN e.from_status IS NULL THEN e.to_status <> 'pendiente_pago'
      -- Un reembolso parcial (O7) deja a propósito una fila con from = to:
      -- no es una transición, es plata que salió de un pedido que sigue su
      -- curso. Sin esta excepción, cada devolución parcial legítima saldría
      -- reportada como arista imposible, y un control que grita siempre es un
      -- control que nadie mira. Se reconoce por el prefijo del motivo, que es
      -- una constante compartida con payment-recovery.ts.
      WHEN e.from_status = e.to_status AND e.reason LIKE ${parcialLike} THEN FALSE
      -- Una edición de pedido sin pagar (O16) deja otra fila con from = to,
      -- por el mismo motivo: cambió la plata del pedido, no su estado. La
      -- identidad total = subtotal - descuento + envio la sigue verificando
      -- findTotalMismatches, que es el control que importa aca: si la edicion
      -- dejara los totales torcidos, sale reportada ahi.
      WHEN e.from_status = e.to_status AND e.reason LIKE ${edicionLike} THEN FALSE
      -- Una devolución de mercadería deja otra fila con from = to: volvieron
      -- cosas al local (y quizás al stock), el pedido no cambió de estado. La
      -- plata, si se devuelve, va por el reembolso y su propio control.
      WHEN e.from_status = e.to_status AND e.reason LIKE ${devolucionLike} THEN FALSE
      ELSE (e.from_status, e.to_status) NOT IN (${sql.join(allowed, sql`, `)})
    END
    ORDER BY e.id DESC
    LIMIT ${CROSS_CHECK_LIMIT}
  `);

  return rowsOf(result).map((row) => ({
    kind: "arista_imposible" as const,
    ...identity(row),
    detail:
      `el evento ${row.eventId} registra "${row.fromStatus}" → "${row.toStatus}" ` +
      `(actor ${row.actor}), que la máquina de estados no permite`,
  }));
}

/**
 * El ledger de devoluciones contra el acumulado del pago (O7).
 *
 * Tres igualdades que tienen que valer siempre, y las tres se rompen de formas
 * distintas y silenciosas:
 *
 * 1. **`payments.refunded_pyg = Σ refunds.amount_pyg`.** El acumulado existe
 *    para poder decidir "¿puedo devolver ₲50.000 más?" con la fila bloqueada,
 *    sin un `SUM()` adentro del lock. El precio de esa denormalización es que
 *    puede separarse del ledger — y si se separa, el próximo reembolso se
 *    calcula contra un número que no es la verdad.
 * 2. **`refunded_pyg ≤ amount_pyg`.** Devolver más de lo que entró.
 * 3. **`status = 'refunded' ⇔ refunded_pyg = amount_pyg`.** Las dos
 *    direcciones: un pago marcado devuelto al que le falta plata en el ledger,
 *    y un pago con todo devuelto que sigue figurando como cobrado.
 *
 * Se reportan contra el pedido del pago porque es lo que el dueño puede abrir.
 */
export async function findRefundMismatches(
  executor?: Executor,
): Promise<CrossCheckFinding[]> {
  const tx = executor ?? getDb();

  const result = await tx.execute(sql`
    SELECT
      o.id            AS orderId,
      o.order_number  AS orderNumber,
      o.status        AS orderStatus,
      p.id            AS paymentId,
      p.status        AS paymentStatus,
      p.amount_pyg    AS amountPyg,
      p.refunded_pyg  AS refundedPyg,
      COALESCE(r.total, 0) AS ledgerPyg
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    LEFT JOIN (
      SELECT payment_id, SUM(amount_pyg) AS total
      FROM refunds
      GROUP BY payment_id
    ) r ON r.payment_id = p.id
    WHERE p.refunded_pyg <> COALESCE(r.total, 0)
       OR p.refunded_pyg > p.amount_pyg
       OR (p.status = 'refunded' AND p.refunded_pyg <> p.amount_pyg)
       OR (p.status <> 'refunded' AND p.amount_pyg > 0 AND p.refunded_pyg = p.amount_pyg)
    ORDER BY p.id DESC
    LIMIT ${CROSS_CHECK_LIMIT}
  `);

  return rowsOf(result).map((row) => ({
    kind: "devoluciones_no_cuadran" as const,
    ...identity(row),
    detail:
      `el pago ${row.paymentId} (${row.paymentStatus}) cobró ${row.amountPyg} y tiene ` +
      `refunded_pyg = ${row.refundedPyg}, pero el ledger de devoluciones suma ${row.ledgerPyg}`,
  }));
}

export type ReconciliationReport = {
  totalMismatches: ReconciliationRow[];
  lineMismatches: LineMismatch[];
  crossChecks: CrossCheckFinding[];
  ok: boolean;
};

export async function reconcile(executor?: Executor): Promise<ReconciliationReport> {
  const [totalMismatches, lineMismatches, ...cross] = await Promise.all([
    findTotalMismatches({}, executor),
    findLineMismatches({}, executor),
    findOrdersPaidWithoutPayment(executor),
    findPaymentsWithoutTransition(executor),
    findPaymentAmountMismatches(executor),
    findApprovedReceiptsWithoutMove(executor),
    findImpossibleEdges(executor),
    findDiscountsWithoutCoupon(executor),
    findDiscountsOverSubtotal(executor),
    findCouponUsageMismatches(executor),
    findRefundMismatches(executor),
  ]);

  const crossChecks = cross.flat();

  return {
    totalMismatches,
    lineMismatches,
    crossChecks,
    ok: totalMismatches.length === 0 && lineMismatches.length === 0 && crossChecks.length === 0,
  };
}

/** Lista de estados como literales SQL, para un `IN (...)`. */
function statusList(statuses: readonly string[]) {
  return sql.join(
    statuses.map((status) => sql`${status}`),
    sql`, `,
  );
}

/** Las tres columnas que toda fila de un control cruzado trae. */
function identity(row: Record<string, unknown>) {
  return {
    orderId: Number(row.orderId),
    orderNumber: String(row.orderNumber),
    orderStatus: String(row.orderStatus),
  };
}

/** mysql2 devuelve `[rows, fields]`; drizzle a veces pasa las filas peladas. */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const candidate = Array.isArray(result) ? result[0] : result;
  return Array.isArray(candidate) ? (candidate as Array<Record<string, unknown>>) : [];
}
