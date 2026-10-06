import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { payments, type PaymentMethod, type PaymentProvider } from "@/db/schema";

import type { Executor } from "./executor";

/**
 * El pago que no pasa por ninguna pasarela (TASKS.md §27, ARCH.md §5).
 *
 * Hasta acá la única forma de pago que dejaba rastro en `payments` era
 * Pagopar. Una transferencia aprobada por el dueño y un contra entrega
 * llegaban a `pagado` sin ninguna fila: la plata entraba y la tabla que existe
 * para registrar plata no se enteraba. Eso obligaba a acotar el control
 * `pedido_cobrado_sin_pago` a `payment_method = 'tarjeta'`, o sea a apagarlo
 * justo para los dos caminos por los que la tienda cobra de verdad.
 *
 * El registro se escribe **en la misma transacción que cobra el pedido**. No
 * es un detalle de prolijidad: si fuera un segundo paso, un proceso que muere
 * en el medio dejaría el pedido cobrado y el pago sin registrar, que es
 * exactamente el descuadre que este módulo existe para hacer imposible.
 *
 * Por qué vive dentro de `transitionOrder` y no en cada llamador: hay tres
 * caminos a `pagado` —el comprobante aprobado, el botón del panel y el webhook
 * de Pagopar— y el mismo argumento que ARCH.md §4.1 hace para el re-chequeo de
 * stock vale acá. Un registro que hay que acordarse de escribir en cada
 * llamador es un registro que el cuarto llamador no va a escribir.
 */

/**
 * Qué proveedor le corresponde a cada método de pago.
 *
 * `tarjeta` es `null` a propósito: esa fila la escribe `startPagoparCheckout`
 * antes de redirigir al comprador, con el `hash_pedido` de Pagopar como
 * `provider_ref`, y el webhook la pasa a `paid`. Escribir otra acá duplicaría
 * el mismo cobro en dos filas.
 */
const PROVIDER_BY_METHOD: Record<PaymentMethod, PaymentProvider | null> = {
  transferencia: "spi",
  contra_entrega: "cod",
  tarjeta: null,
};

export type ManualPaymentOrder = {
  id: number;
  orderNumber: string;
  paymentMethod: PaymentMethod;
  totalPyg: number;
};

/**
 * La referencia externa del pago manual: el número de pedido.
 *
 * No hay un id de transacción que copiar —nadie lo emite— así que la
 * referencia tiene que salir de algo que ya identifique el cobro sin
 * ambigüedad. `orders.order_number` es inmutable, único, y es lo que el dueño
 * tiene delante cuando busca la transferencia en el extracto del banco.
 *
 * Que sea derivable del pedido es justo lo que hace que
 * `UNIQUE(provider, provider_ref)` signifique algo: "un solo cobro manual por
 * pedido y por proveedor". Un doble click, un reintento o un pedido que vuelve
 * a entrar a `pagado` chocan contra ese índice en vez de duplicar la plata.
 */
export function manualPaymentRef(orderNumber: string): string {
  return orderNumber;
}

/**
 * Registra el cobro manual de un pedido que acaba de entrar a `pagado`.
 *
 * Idempotente por el índice único, no por una lectura previa: entre un
 * `SELECT` y un `INSERT` entra la otra pestaña del dueño. `INSERT IGNORE` deja
 * que MySQL resuelva la carrera con el índice que ya existe para eso.
 *
 * Si la fila ya estaba, no se toca. Es deliberado: un pago que alguien marcó
 * `refunded` (la devolución del panel) no puede volver a `paid` porque el
 * pedido pasó otra vez por acá — eso resucitaría plata devuelta.
 *
 * Devuelve `true` si escribió la fila, `false` si ya existía.
 */
export async function recordManualPayment(
  tx: Executor,
  order: ManualPaymentOrder,
): Promise<boolean> {
  const provider = PROVIDER_BY_METHOD[order.paymentMethod];
  if (!provider) return false;

  const result = await tx
    .insert(payments)
    .ignore()
    .values({
      orderId: order.id,
      provider,
      providerRef: manualPaymentRef(order.orderNumber),
      // Entero de guaraníes, tal cual salió de `orders.total_pyg`. No pasa por
      // ninguna aritmética: el monto cobrado es el total del pedido y nada más.
      amountPyg: order.totalPyg,
      status: "paid",
    });

  return affectedRows(result) > 0;
}

/* ---------------------------------------------------------------------------
 * Backfill de los pedidos ya cobrados
 * ------------------------------------------------------------------------- */

/** Estados en los que la plata ya entró: mismos que usa la reconciliación. */
const SETTLED = ["pagado", "preparando", "enviado", "entregado", "reembolsado"] as const;

export type BackfillRow = {
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  paymentMethod: string;
  provider: PaymentProvider;
  amountPyg: number;
};

export type BackfillResult = {
  /** Los pedidos que les falta la fila, con lo que se les escribiría. */
  pending: BackfillRow[];
  /** Cuántas filas se escribieron. `0` en un ensayo. */
  inserted: number;
};

/**
 * Pedidos ya cobrados por el camino manual que quedaron sin fila de pago.
 *
 * Es un script y no una migración a propósito. El schema de este proyecto se
 * aplica con `drizzle-kit push` (ver `pnpm db:push`), que compara estructuras y
 * **no corre los archivos de `drizzle/`**: una migración con el backfill
 * adentro se aplicaría en los tests y jamás en el servidor del comercio, que
 * es el único lugar donde hay filas viejas que arreglar. Además esto escribe
 * plata: el dueño tiene que poder mirar la lista antes de que se escriba
 * (`--dry-run`) y volver a correrlo sin miedo si se corta a la mitad.
 *
 * Idempotente por el mismo índice único que el camino en vivo: correrlo diez
 * veces escribe exactamente lo que falta la primera vez.
 */
export async function backfillManualPayments(
  options: { apply?: boolean } = {},
  executor?: Executor,
): Promise<BackfillResult> {
  const tx = executor ?? getDb();

  // El filtro entero corre en MySQL. Los montos se transportan, no se calculan.
  const result = await tx.execute(sql`
    SELECT
      o.id             AS orderId,
      o.order_number   AS orderNumber,
      o.status         AS orderStatus,
      o.payment_method AS paymentMethod,
      o.total_pyg      AS totalPyg
    FROM orders o
    WHERE o.payment_method IN ('transferencia', 'contra_entrega')
      AND o.status IN (${sql.join(
        SETTLED.map((status) => sql`${status}`),
        sql`, `,
      )})
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.order_id = o.id AND p.status IN ('paid', 'refunded')
      )
    ORDER BY o.id
  `);

  const pending: BackfillRow[] = rowsOf(result).map((row) => {
    const method = String(row.paymentMethod) as PaymentMethod;
    return {
      orderId: Number(row.orderId),
      orderNumber: String(row.orderNumber),
      orderStatus: String(row.orderStatus),
      paymentMethod: method,
      // El `WHERE` de arriba ya descartó `tarjeta`, así que el proveedor existe.
      provider: PROVIDER_BY_METHOD[method] as PaymentProvider,
      amountPyg: Number(row.totalPyg),
    };
  });

  if (!options.apply || pending.length === 0) {
    return { pending, inserted: 0 };
  }

  // La escritura es un `INSERT ... SELECT`: el monto va de `orders.total_pyg` a
  // `payments.amount_pyg` sin salir de MySQL. La lista de arriba pasó por
  // `Number()` para poder imprimirla, y ese viaje es justamente el que no
  // queremos que haga la plata que se escribe.
  //
  // `IGNORE` + el mismo `NOT EXISTS`: idempotente por partida doble, incluso si
  // alguien cobra un pedido desde el panel mientras esto corre.
  const written = await tx.execute(sql`
    INSERT IGNORE INTO payments (order_id, provider, provider_ref, amount_pyg, status, created_at)
    SELECT
      o.id,
      CASE o.payment_method WHEN 'transferencia' THEN 'spi' ELSE 'cod' END,
      o.order_number,
      o.total_pyg,
      'paid',
      COALESCE(o.paid_at, o.created_at)
    FROM orders o
    WHERE o.payment_method IN ('transferencia', 'contra_entrega')
      AND o.status IN (${sql.join(
        SETTLED.map((status) => sql`${status}`),
        sql`, `,
      )})
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.order_id = o.id AND p.status IN ('paid', 'refunded')
      )
  `);

  return { pending, inserted: affectedRows(written) };
}

/** mysql2 devuelve `affectedRows`; drizzle lo pasa en el primer elemento. */
function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number })?.affectedRows ?? 0);
}

/** mysql2 devuelve `[rows, fields]`; drizzle a veces pasa las filas peladas. */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const candidate = Array.isArray(result) ? result[0] : result;
  return Array.isArray(candidate) ? (candidate as Array<Record<string, unknown>>) : [];
}
