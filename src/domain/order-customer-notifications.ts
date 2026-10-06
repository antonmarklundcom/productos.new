import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { TIENDA } from "@/config/tienda";
import { t } from "@/i18n";
import { formatGs } from "@/lib/money";
import { formatDateTimePY } from "@/lib/py";

import { resolveMessageSender, type MessageSender } from "./messaging";
import { firstName, buyerOrderUrl } from "./order-messages";
import { log, mensajeDe } from "@/lib/log";
import { valorIntegracion, type CampoDe } from "@/lib/integraciones";

/**
 * Los avisos por WhatsApp que recibe la COMPRADORA (fase O3, sigue a O2 —
 * `order-notifications.ts`, el aviso al comercio).
 *
 * O2 avisaba al comercio de que entró un pedido; el comprador no se enteraba
 * de nada del servidor salvo lo que ella misma decidiera mirar en la página
 * del pedido. Acá se agregan tres avisos que salen solos, en el momento en
 * que cambian: **confirmado** (el pedido quedó registrado), **pagado** (la
 * plata entró, por el camino que sea) y **enviado** (salió a reparto).
 *
 * O15 suma un cuarto que no lo dispara una transición sino el reloj:
 * **recordatorio**, cuando al pedido sin pagar le quedan menos de 6 h de
 * reserva. Comparte el texto y el interruptor de plantilla con los otros tres;
 * quién lo elige y cómo no se manda dos veces vive en
 * `src/domain/payment-reminders.ts`.
 *
 * Misma filosofía que O2, y por eso comparten `notify-timing.ts`:
 *
 * 1. **Nunca frenan ni demoran una transición.** Se disparan sin `await`
 *    después de que el pedido ya quedó escrito — desde `createOrder()` para
 *    "confirmado" y desde el hook post-transición de `transitionOrder()` para
 *    "pagado" y "enviado" (`src/domain/orders.ts`). Un Meta caído no puede
 *    hacer perder ni un pedido ni un cobro.
 * 2. **Sin la plantilla de ese aviso, apagado — en cualquier canal.** A
 *    diferencia del aviso al comercio (que sale por la consola de dev en
 *    cuanto hay `WHATSAPP_NUMBER`, sin plantilla), acá la plantilla
 *    `WHATSAPP_CLOUD_TEMPLATE_CLIENTE_*` es el único interruptor de cada
 *    aviso: son tres decisiones independientes del comercio ("¿le aviso
 *    cuando pago? ¿cuando confirmo?"), y una tienda que no cargó ninguna
 *    tiene que quedar exactamente como antes de este archivo, hasta en dev.
 * 3. La transición guarda una fila única en `notification_outbox` en su
 *    transacción. Un worker reclama esa fila después del commit y registra
 *    el resultado en `order_events`. Sólo un rechazo definitivo se reintenta
 *    automáticamente; entrega incierta exige revisión del dueño.
 */

export type CustomerNoticeKind =
  "confirmado" | "pagado" | "enviado" | "recordatorio" | "resena";

/**
 * El campo de `/admin/integraciones` → WhatsApp de cada aviso. El fallback de
 * entorno de siempre (`WHATSAPP_CLOUD_TEMPLATE_CLIENTE_*`) está declarado en
 * `src/lib/integraciones.ts`.
 */
const TEMPLATE_CAMPO = {
  confirmado: "plantillaClienteConfirmado",
  pagado: "plantillaClientePagado",
  enviado: "plantillaClienteEnviado",
  // O15. No lo dispara una transición sino el cron, y por eso su idempotencia
  // no vive en `order_events` como la de los otros tres sino en una columna
  // propia (`orders.payment_reminder_sent_at`): el cron corre cada 15 minutos
  // y una fila de evento no se puede pedir "sólo si no existe" en una sola
  // sentencia. El detalle está en `src/domain/payment-reminders.ts`.
  recordatorio: "plantillaClienteRecordatorio",
  // Pedido de reseña: sale al entrar a `entregado`, por el mismo hook y con
  // la misma idempotencia en `order_events` que "enviado". El link es el del
  // pedido, que es donde está el formulario (`src/domain/reviews.ts`).
  resena: "plantillaClienteResena",
} as const satisfies Record<CustomerNoticeKind, CampoDe<"whatsapp">>;

/** El nombre de la plantilla de Meta para este aviso, o `null` si no se cargó. */
export function customerNoticeTemplate(
  kind: CustomerNoticeKind
): string | null {
  return valorIntegracion("whatsapp", TEMPLATE_CAMPO[kind]);
}

export type CustomerNotifier = {
  sender: MessageSender;
  /** Nombre de la plantilla de Meta, o `undefined` para el sender de consola. */
  templateName?: string;
};

/**
 * Con qué mandar este aviso, o `null` si esta tienda no lo pidió.
 *
 * La plantilla es obligatoria pase lo que pase con el canal (ver regla 2 de
 * arriba): sin ella, ni el sender de consola de dev manda nada.
 */
export function resolveCustomerNotifier(
  kind: CustomerNoticeKind
): CustomerNotifier | null {
  const templateName = customerNoticeTemplate(kind);
  if (!templateName) return null;

  const sender = resolveMessageSender();
  if (!sender) return null;

  return sender.channel === "whatsapp" ? { sender, templateName } : { sender };
}

/** ¿Esta tienda le manda este aviso a la compradora? */
export function customerNoticeConfigured(kind: CustomerNoticeKind): boolean {
  return resolveCustomerNotifier(kind) !== null;
}

export type CustomerNoticeOrder = {
  orderId: number;
  orderNumber: string;
  customerName: string;
  accessToken: string;
  totalPyg: number;
  /** Snapshot del método (FASE 3); ausente en pedidos viejos o tiendas sin configurar. */
  shippingMethodName?: string | null;
  /**
   * Seguimiento del envío (O5). Los tres pueden faltar: una tienda que
   * reparte en moto propia despacha sin courier ni guía, y el aviso tiene que
   * quedar exactamente como era antes de estas columnas.
   */
  trackingCarrier?: string | null;
  trackingCode?: string | null;
  trackingUrl?: string | null;
  /**
   * Hasta cuándo puede pagar (O15). Sólo lo usa el recordatorio; los otros
   * tres avisos salen de un pedido que ya no está esperando plata.
   */
  reservedUntil?: Date | null;
};

/**
 * El texto de cada aviso. Separado del envío para poder testearlo sin red,
 * igual que `newOrderNoticeBody`.
 *
 * `note` es el número de seguimiento o la nota que tipeó el admin al marcar
 * "enviado" — el mismo `reason` que ya queda en el evento de la transición
 * (`advanceOrder` → `transitionOrder`). Sólo se usa para "enviado".
 */
export function customerNoticeBody(
  kind: CustomerNoticeKind,
  order: CustomerNoticeOrder,
  options: { note?: string | null; tienda?: string } = {}
): string {
  const nombre = firstName(order.customerName);
  const total = formatGs(order.totalPyg);
  const url = buyerOrderUrl(order);
  const metodo = order.shippingMethodName?.trim();

  if (kind === "confirmado") {
    return [
      t("wa.cliente.confirmado", {
        nombre,
        numero: order.orderNumber,
        total,
        tienda: options.tienda ?? TIENDA.nombre,
      }),
      ...(metodo ? [t("wa.cliente.confirmado.envio", { metodo })] : []),
      t("wa.cliente.verPedido", { url }),
    ].join("\n");
  }

  if (kind === "pagado") {
    return [
      t("wa.cliente.pagado", { nombre, numero: order.orderNumber, total }),
      t("wa.cliente.verPedido", { url }),
    ].join("\n");
  }

  if (kind === "recordatorio") {
    // La hora límite va en hora de Asunción y con todas las letras: "hasta
    // las 18:40" es lo único accionable del mensaje. Si el pedido no tuviera
    // `reserved_until` —no debería: el recordatorio se elige justamente por
    // esa columna— sale el aviso sin la línea del plazo antes que con una
    // fecha inventada.
    const limite = order.reservedUntil
      ? formatDateTimePY(order.reservedUntil)
      : null;
    return [
      t("wa.cliente.recordatorio", {
        nombre,
        numero: order.orderNumber,
        total,
      }),
      ...(limite ? [t("wa.cliente.recordatorio.limite", { limite })] : []),
      t("wa.cliente.recordatorio.pagar", { url }),
    ].join("\n");
  }

  if (kind === "resena") {
    return t("wa.cliente.resena", { nombre, numero: order.orderNumber, url });
  }

  // "enviado"
  const nota = options.note?.trim();
  // El seguimiento (O5). El courier y la guía van en una sola línea porque
  // así se leen: "Transporte: Aereopar · Guía 12345". Cada mitad puede
  // faltar sola —una moto propia no tiene guía, un courier chico no da
  // link— y sin ninguna el texto es exactamente el de antes.
  const courier = order.trackingCarrier?.trim();
  const guia = order.trackingCode?.trim();
  const linkSeguimiento = order.trackingUrl?.trim();
  const seguimiento =
    courier && guia
      ? t("wa.cliente.enviado.seguimiento", { courier, guia })
      : courier
        ? t("wa.cliente.enviado.courier", { courier })
        : guia
          ? t("wa.cliente.enviado.guia", { guia })
          : null;

  return [
    t("wa.cliente.enviado", { nombre, numero: order.orderNumber }),
    ...(metodo ? [t("wa.cliente.enviado.envio", { metodo })] : []),
    ...(seguimiento ? [seguimiento] : []),
    ...(linkSeguimiento
      ? [t("wa.cliente.enviado.seguirEnvio", { url: linkSeguimiento })]
      : []),
    ...(nota ? [t("wa.cliente.enviado.nota", { nota })] : []),
    t("wa.cliente.verPedido", { url }),
  ].join("\n");
}

export async function notifyCustomerOrderEvent(
  orderId: number,
  kind: CustomerNoticeKind,
  options: { notifier?: CustomerNotifier | null; note?: string | null } = {}
): Promise<void> {
  try {
    const notifier =
      options.notifier === undefined
        ? resolveCustomerNotifier(kind)
        : options.notifier;
    if (!notifier) return;
    const { enqueueOrderNotice, dispatchOrderNotices } =
      await import("./notification-outbox");
    const [order] = await getDb()
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return;
    await getDb().transaction((tx) =>
      enqueueOrderNotice(tx, orderId, kind, order.status, options.note, true)
    );
    await dispatchOrderNotices({ orderId, notifier });
  } catch (error) {
    log.error("notifyCustomerOrderEvent failed", { error: mensajeDe(error) });
  }
}
