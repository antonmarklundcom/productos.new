import { safeError } from "@/lib/safe-error";
import { and, count, gte, inArray, lt, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { t } from "@/i18n";
import { comercioWhatsApp } from "@/lib/comercio";
import { formatGs } from "@/lib/money";
import { startOfDayPY } from "@/lib/py";

import {
  DEFAULT_REORDER_POINT,
  lowStockVariants,
  type LowStockVariant,
} from "./admin-products";
import { getStoreSettings } from "./store-settings";
import { umbralStockBajo } from "./store-settings-schema";
import type { Executor } from "./executor";
import { resolveMessageSender, type MessageSender } from "./messaging";
import { withTimeout } from "./notify-timing";
import { log, mensajeDe } from "@/lib/log";
import { valorIntegracion } from "@/lib/integraciones";

/**
 * El resumen de la mañana que el dueño recibe por WhatsApp (plan-operacion
 * §5.2 C).
 *
 * El problema que resuelve es concreto y no es de software: el panel está
 * lleno de información y **nadie lo abre a las ocho de la mañana**. Un
 * comprobante sin revisar de ayer a la tarde se queda sin revisar hasta que
 * alguien se acuerda, y un pedido sin pagar de hace dos días no se recupera
 * nunca porque nadie lo vio. Este mensaje empuja las cuatro cosas que hay que
 * mirar antes de abrir, al único lugar que el dueño sí mira.
 *
 * Tres decisiones que valen la pena explicar:
 *
 * 1. **Devuelve un objeto, no un texto.** `buildDailyDigest()` arma los
 *    números y `digestBody()` los escribe. Así el contenido se puede testear
 *    sin red y el texto sin base.
 * 2. **Si no hay nada, igual se manda.** "Sin novedades" es información: le
 *    dice al dueño que el cron está vivo. Un resumen que se calla cuando no
 *    hay nada es indistinguible de un resumen que dejó de funcionar hace tres
 *    semanas, y para cuando se nota, ya se perdieron los comprobantes de esas
 *    tres semanas.
 * 3. **Nada de datos de compradoras.** Del pedido sale el número y nada más:
 *    ni teléfono, ni dirección, ni nombre. Esto viaja por Meta y queda en el
 *    historial de un WhatsApp que se comparte más de lo que uno quisiera.
 */

/** Más que esto y no vale la pena seguir esperando: el resumen ya está armado. */
const AVISO_TIMEOUT_MS = 10_000;

/** El nombre de la plantilla de Meta, o `null` si esta tienda no la cargó. */
export function digestTemplate(): string | null {
  return valorIntegracion("whatsapp", "plantillaResumenDiario");
}

export type DigestNotifier = {
  sender: MessageSender;
  templateName?: string;
  to: string;
};

/**
 * Con qué mandar el resumen, o `null` si esta tienda no lo pidió.
 *
 * Igual que los avisos a la compradora: **la plantilla es el interruptor**, en
 * cualquier canal. Sin ella no sale ni por la consola de dev — mandar un
 * resumen diario que el dueño no configuró es exactamente el tipo de cosa que
 * una tienda recién actualizada no puede empezar a hacer sola.
 */
export function resolveDigestNotifier(): DigestNotifier | null {
  const templateName = digestTemplate();
  if (!templateName) return null;

  const to = comercioWhatsApp();
  if (!to) return null;

  const sender = resolveMessageSender();
  if (!sender) return null;

  return sender.channel === "whatsapp"
    ? { sender, templateName, to }
    : { sender, to };
}

/** ¿Esta tienda recibe el resumen diario? */
export function digestConfigured(): boolean {
  return resolveDigestNotifier() !== null;
}

/** Un pedido que lleva demasiado tiempo sin pagarse. */
export type StaleOrder = { orderNumber: string; horas: number };

export type DailyDigest = {
  /** Comprobantes de transferencia esperando que alguien los mire. */
  comprobantesPendientes: number;
  /** Pedidos en `pendiente_pago` / `esperando_verificacion` de más de 24 h. */
  sinPagar: StaleOrder[];
  /** Variantes en o por debajo de su punto de reposición. */
  stockBajo: LowStockVariant[];
  /** Lo vendido ayer, día calendario de Asunción. */
  ayer: { totalPyg: number; orders: number };
  /** `true` cuando las cuatro secciones están vacías. */
  sinNovedades: boolean;
};

/** Estados que cuentan como "todavía no entró la plata" para el resumen. */
const SIN_PAGAR: readonly (
  "pendiente_pago" | "esperando_verificacion" | "rechazado"
)[] = ["pendiente_pago", "esperando_verificacion", "rechazado"];

/** A partir de cuántas horas un pedido sin pagar entra al resumen. */
export const SIN_PAGAR_HORAS = 24;

/** Cuántos pedidos y variantes entran como máximo: el mensaje tiene que caber. */
const MAX_POR_SECCION = 10;

export async function buildDailyDigest(
  now: Date = new Date(),
  executor?: Executor
): Promise<DailyDigest> {
  const tx = executor ?? getDb();

  const inicioDeHoy = startOfDayPY(now);
  // "Ayer" es el día calendario de Asunción anterior al de `now`, no
  // "las últimas 24 horas": el dueño compara contra su día de trabajo.
  const inicioDeAyer = startOfDayPY(
    new Date(inicioDeHoy.getTime() - 12 * 3600_000)
  );
  const limiteSinPagar = new Date(now.getTime() - SIN_PAGAR_HORAS * 3600_000);

  const [comprobantes, viejos, ventasAyer, stockBajo] = await Promise.all([
    tx
      .select({ n: count() })
      .from(orders)
      .where(inArray(orders.status, ["esperando_verificacion"])),
    tx
      .select({
        orderNumber: orders.orderNumber,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.status, [...SIN_PAGAR]),
          lt(orders.createdAt, limiteSinPagar)
        )
      )
      .orderBy(orders.createdAt)
      .limit(MAX_POR_SECCION),
    tx
      .select({
        // COALESCE porque SUM sobre cero filas devuelve NULL, no 0.
        totalPyg: sql<string | number>`COALESCE(SUM(${orders.totalPyg}), 0)`,
        orders: count(),
      })
      .from(orders)
      .where(
        and(
          inArray(orders.status, [
            "pagado",
            "preparando",
            "enviado",
            "entregado",
          ]),
          gte(orders.createdAt, inicioDeAyer),
          lt(orders.createdAt, inicioDeHoy)
        )
      ),
    // El umbral global es el de `/admin/ajustes` (sección stock) o el de
    // siempre; el de cada variante (`reorder_point`) igual le gana.
    getStoreSettings().then(({ stock }) =>
      lowStockVariants(
        umbralStockBajo(stock, DEFAULT_REORDER_POINT),
        MAX_POR_SECCION,
        tx
      )
    ),
  ]);

  const comprobantesPendientes = comprobantes[0]?.n ?? 0;
  const sinPagar: StaleOrder[] = viejos.map((row) => ({
    orderNumber: row.orderNumber,
    horas: Math.floor((now.getTime() - row.createdAt.getTime()) / 3600_000),
  }));
  const ayer = {
    // mysql2 devuelve la suma de un BIGINT como string cuando no entra exacta.
    totalPyg: Number(ventasAyer[0]?.totalPyg ?? 0),
    orders: ventasAyer[0]?.orders ?? 0,
  };

  return {
    comprobantesPendientes,
    sinPagar,
    stockBajo,
    ayer,
    // Las ventas de ayer **no** cuentan para "sin novedades": un día sin
    // ventas es una novedad, y de las importantes.
    sinNovedades:
      comprobantesPendientes === 0 &&
      sinPagar.length === 0 &&
      stockBajo.length === 0 &&
      ayer.orders === 0,
  };
}

/**
 * El texto del resumen. Separado del envío para poder testearlo sin red,
 * igual que `newOrderNoticeBody`.
 *
 * Las secciones vacías se omiten en vez de salir con un cero: un mensaje de
 * WhatsApp con cuatro líneas donde tres dicen "0" se deja de leer a la
 * semana.
 */
export function digestBody(digest: DailyDigest): string {
  const lineas: string[] = [t("wa.resumen.titulo")];

  if (digest.sinNovedades) {
    lineas.push(t("wa.resumen.sinNovedades"));
    return lineas.join("\n");
  }

  if (digest.comprobantesPendientes > 0) {
    lineas.push(
      t("wa.resumen.comprobantes", { n: digest.comprobantesPendientes })
    );
  }

  if (digest.sinPagar.length > 0) {
    lineas.push(t("wa.resumen.sinPagar", { n: digest.sinPagar.length }));
    for (const pedido of digest.sinPagar) {
      lineas.push(
        t("wa.resumen.sinPagarLinea", {
          numero: pedido.orderNumber,
          horas: pedido.horas,
        })
      );
    }
  }

  if (digest.stockBajo.length > 0) {
    lineas.push(t("wa.resumen.stockBajo", { n: digest.stockBajo.length }));
    for (const variante of digest.stockBajo) {
      lineas.push(
        t("wa.resumen.stockBajoLinea", {
          producto: variante.productName,
          etiqueta: variante.label,
          quedan: variante.available,
        })
      );
    }
  }

  if (digest.ayer.orders > 0) {
    lineas.push(
      t("wa.resumen.ayer", {
        n: digest.ayer.orders,
        total: formatGs(digest.ayer.totalPyg),
      })
    );
  } else {
    lineas.push(t("wa.resumen.ayerSinVentas"));
  }

  return lineas.join("\n");
}

export type DigestSendResult = {
  sent: boolean;
  /** El motivo cuando `sent` es `false`. `null` cuando salió bien. */
  error: string | null;
  digest: DailyDigest;
};

/**
 * Arma el resumen y lo manda. **No tira nunca**: quien la llama es una ruta de
 * cron, y un Meta caído tiene que devolver 200 con `sent: false` — un 500 hace
 * que Hostinger reintente y, con el `job_runs` ya marcado, el reintento no
 * mandaría nada igual.
 */
export async function sendDailyDigest(
  options: {
    now?: Date;
    notifier?: DigestNotifier | null;
    executor?: Executor;
  } = {}
): Promise<DigestSendResult> {
  const digest = await buildDailyDigest(
    options.now ?? new Date(),
    options.executor
  );

  const notifier =
    options.notifier === undefined ? resolveDigestNotifier() : options.notifier;
  if (!notifier) return { sent: false, error: "apagado", digest };

  try {
    await withTimeout(
      notifier.sender.send({
        to: notifier.to,
        body: digestBody(digest),
        templateName: notifier.templateName,
      }),
      AVISO_TIMEOUT_MS
    );
    return { sent: true, error: null, digest };
  } catch (error) {
    log.error("resumen diario: no se pudo mandar", { error: mensajeDe(error) });
    const motivo = safeError(error).message;
    return {
      sent: false,
      error: motivo.replace(/\s+/g, " ").trim().slice(0, 500),
      digest,
    };
  }
}
