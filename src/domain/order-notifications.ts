import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { orders, type PaymentMethod } from "@/db/schema";
import { t } from "@/i18n";
import { comercioWhatsApp } from "@/lib/comercio";
import { formatGs } from "@/lib/money";
import { siteOrigin } from "@/lib/site-url";

import {
  resolveMessageSender,
  whatsappOwnerTemplate,
  type MessageSender,
} from "./messaging";
import { log, mensajeDe } from "@/lib/log";

/**
 * El aviso de pedido nuevo al comercio (fable/plan.md §5.2, F2 de la revisión).
 *
 * Antes de esto, el único "aviso" era un link de WhatsApp que **la compradora**
 * decidía tocar o no: un pedido con el comprobante ya subido podía quedar 24
 * horas sin que nadie lo mirara. Ahora el servidor le escribe al número del
 * comercio en cuanto el pedido queda commiteado.
 *
 * Tres reglas que no se negocian:
 *
 * 1. **Nunca hace fallar ni demorar el checkout.** `notifyOwnerNewOrder` no
 *    tira nunca: atrapa todo adentro y lo deja anotado en `order_events`. La
 *    compradora no puede perder su pedido porque Meta esté caído.
 * 2. **Sin variables, apagado.** Sin número del comercio, sin sender, o —en
 *    WhatsApp Cloud— sin la plantilla aprobada para este mensaje, no hay aviso
 *    y la tienda es exactamente la de antes.
 * 3. **Deja rastro.** Salga o falle, queda una fila en `order_events` con
 *    `actor: "sistema"`. Un aviso que se pierde en silencio es peor que no
 *    tenerlo: el dueño creería que no hubo pedidos.
 */

/** Más que esto y no vale la pena seguir esperando: el pedido ya está guardado. */

export type OwnerNotifier = {
  sender: MessageSender;
  /** Nombre de la plantilla de Meta, o `undefined` para el sender de consola. */
  templateName?: string;
  to: string;
};

/**
 * Con qué mandar el aviso, o `null` si esta tienda no puede mandarlo.
 *
 * `null` es la respuesta esperada en la mayoría de las tiendas: es todo el
 * mecanismo que apaga la feature (regla de `docs/ENV-OPCIONAL.md`: una variable vacía
 * apaga, no rompe).
 */
export function resolveOwnerNotifier(): OwnerNotifier | null {
  const to = comercioWhatsApp();
  if (!to) return null;

  const sender = resolveMessageSender();
  if (!sender) return null;

  if (sender.channel === "whatsapp") {
    const templateName = whatsappOwnerTemplate();
    // Sin plantilla propia el mensaje saldría con la del código de login:
    // Meta lo rechaza, y si no lo rechazara sería peor.
    if (!templateName) return null;
    return { sender, templateName, to };
  }

  return { sender, to };
}

/** ¿Esta tienda le avisa al comercio de los pedidos nuevos? */
export function ownerNotificationsConfigured(): boolean {
  return resolveOwnerNotifier() !== null;
}

export type NewOrderNotice = {
  orderId: number;
  orderNumber: string;
  customerName: string;
  totalPyg: number;
  paymentMethod: PaymentMethod;
  /**
   * Cómo hay que entregarlo (FASE 3). `null` en los pedidos anteriores a
   * `shipping_methods` y en las tiendas que no configuraron métodos: ahí la
   * línea no sale, en vez de salir vacía.
   */
  shippingMethodName?: string | null;
};

/**
 * El texto del aviso. Separado del envío para poder testearlo sin red.
 *
 * Sin `NEXT_PUBLIC_SITE_URL` no hay link absoluto —un `/admin/pedidos/12` en
 * WhatsApp no es clickeable y no dice a qué tienda pertenece—, así que en ese
 * caso el mensaje sale sin la línea del link en vez de con una a medias.
 */
export function newOrderNoticeBody(notice: NewOrderNotice): string {
  const linea = t("wa.aviso.pedidoNuevo", {
    numero: notice.orderNumber,
    total: formatGs(notice.totalPyg),
    metodo: t(`metodo.${notice.paymentMethod}`),
    nombre: notice.customerName.trim(),
  });

  // Cómo se entrega es la primera decisión del comercio al leer el aviso: si
  // es retiro no hay nada que despachar, y si es la moto propia hay que
  // salir. Sin método (pedido viejo, tienda sin configurar) no se inventa
  // ninguna línea.
  const envio = notice.shippingMethodName?.trim();
  const lineas = [
    linea,
    ...(envio ? [t("wa.aviso.pedidoNuevo.envio", { metodo: envio })] : []),
  ];

  const origin = siteOrigin();
  if (origin) {
    const url = new URL(`/admin/pedidos/${notice.orderId}`, origin).toString();
    lineas.push(t("wa.aviso.pedidoNuevo.url", { url }));
  }

  return lineas.join("\n");
}

/**
 * Le avisa al comercio del pedido `orderId`. **No tira nunca.**
 *
 * Se la llama sin `await` desde el checkout, después del commit: la compradora
 * ya tiene su pedido y su link, y nada de lo que pase acá puede cambiarle eso.
 */
export async function notifyOwnerNewOrder(
  orderId: number,
  options: { notifier?: OwnerNotifier | null } = {}
): Promise<void> {
  try {
    const notifier =
      options.notifier === undefined
        ? resolveOwnerNotifier()
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
      enqueueOrderNotice(tx, orderId, "dueno", order.status, null, true)
    );
    await dispatchOrderNotices({ orderId, notifier });
  } catch (error) {
    log.error("notifyOwnerNewOrder failed", { error: mensajeDe(error) });
  }
}
