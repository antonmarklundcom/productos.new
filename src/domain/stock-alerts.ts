import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import { getDb } from '@/db';
import { products, stockAlerts, variants } from '@/db/schema';
import { TIENDA } from '@/config/tienda';
import { t } from '@/i18n';
import type { MessageKey, Params } from '@/i18n';
import { normalizePhonePY } from '@/lib/py';
import { siteOrigin } from '@/lib/site-url';

import { DomainError } from './errors';
import type { Executor } from './executor';
import { getAvailability } from './stock';
import { resolveMessageSender, type MessageSender } from './messaging';
import { withTimeout } from './notify-timing';
import { log, mensajeDe } from '@/lib/log';
import { valorIntegracion } from "@/lib/integraciones";
import { nombreTienda } from '@/lib/marca';

/**
 * "Avisame cuando haya stock" (plan-operacion §5.2 E).
 *
 * Una suscripción es un teléfono esperando una variante, y **no promete
 * ninguna unidad**: cuando vuelve el stock salen los avisos y gana quien
 * compre primero. Reservarle una unidad a cada suscripción sería la otra
 * opción, y es peor: bloquearía mercadería para gente que quizás no vuelva
 * nunca, delante de compradoras que están en la página con la tarjeta en la
 * mano.
 *
 * Las tres reglas que evitan que esto se convierta en una máquina de spam:
 *
 * 1. **`UNIQUE(variant_id, phone)` + `INSERT IGNORE`.** Tocar el botón cinco
 *    veces, o dos personas desde el teléfono del local, es una sola fila.
 * 2. **Se marca `notified_at` ANTES de mandar** (el patrón de
 *    `login-tokens.ts`: `UPDATE … WHERE notified_at IS NULL` + lectura de
 *    confirmación). Si Meta falla, se pierde **un** aviso; al revés —marcar
 *    después— un error a mitad de la tanda vuelve a mandarle a los primeros en
 *    cada reintento.
 * 3. **La respuesta al formulario es siempre la misma.** "Listo, te avisamos"
 *    tanto si la fila se creó como si ya existía: distinguirlo convierte el
 *    formulario en un detector de "¿este número ya está anotado?".
 *
 * El navegador manda variante y teléfono, nada más. Ni el nombre del producto
 * ni si hay stock: eso lo decide el servidor releyendo la base.
 */

export class StockAlertError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = 'StockAlertError';
  }
}

/** Más que esto y no vale la pena seguir esperando por un solo aviso. */
const AVISO_TIMEOUT_MS = 10_000;

/** Cuántos avisos salen por corrida: una tanda tiene que caber en un request. */
export const NOTIFY_BATCH = 50;

/** Cuánto se guarda una suscripción ya avisada antes de que la purgue el cron. */
export const PURGE_AFTER_DAYS = 90;

/** El nombre de la plantilla de Meta, o `null` si esta tienda no la cargó. */
export function stockAlertTemplate(): string | null {
  return valorIntegracion("whatsapp", "plantillaStockDisponible");
}

export type StockAlertNotifier = { sender: MessageSender; templateName?: string };

/**
 * Con qué mandar el aviso, o `null` si esta tienda no ofrece la feature.
 *
 * La plantilla es el interruptor, en cualquier canal — misma regla que los
 * avisos a la compradora. Y el interruptor apaga **las dos mitades**: sin
 * plantilla, el formulario no se dibuja (S11 pregunta por
 * `stockAlertsEnabled`) y `subscribe` rechaza. Guardar suscripciones que
 * nadie va a poder avisar sería prometer algo que la tienda no puede cumplir.
 */
export function resolveStockAlertNotifier(): StockAlertNotifier | null {
  const templateName = stockAlertTemplate();
  if (!templateName) return null;

  const sender = resolveMessageSender();
  if (!sender) return null;

  return sender.channel === 'whatsapp' ? { sender, templateName } : { sender };
}

/** ¿Esta tienda ofrece "avisame cuando haya stock"? */
export function stockAlertsEnabled(): boolean {
  return resolveStockAlertNotifier() !== null;
}

export type SubscribeInput = { variantId: number; phone: string };

/**
 * Anota un teléfono para una variante.
 *
 * Rechaza si la variante no existe, si no está publicada, o si **hay stock**:
 * anotarse para algo que se puede comprar ahora es un malentendido de la
 * compradora, y contestarle "listo, te avisamos" la manda a esperar un aviso
 * que nunca va a salir.
 */
export async function subscribeStockAlert(
  input: SubscribeInput,
  options: { executor?: Executor } = {},
): Promise<void> {
  if (!stockAlertsEnabled()) throw new StockAlertError('error.avisoStock.apagado');

  const phone = normalizePhonePY(input.phone);
  if (!phone) throw new StockAlertError('error.checkout.telefono');

  const tx = options.executor ?? getDb();

  const filas = await tx
    .select({ id: variants.id, isActive: variants.isActive, productActive: products.isActive })
    .from(variants)
    .innerJoin(products, eq(variants.productId, products.id))
    .where(eq(variants.id, input.variantId))
    .limit(1);

  const variante = filas[0];
  if (!variante || !variante.isActive || !variante.productActive) {
    throw new StockAlertError('error.avisoStock.noExiste');
  }

  if ((await getAvailability(input.variantId, tx)) > 0) {
    throw new StockAlertError('error.avisoStock.hayStock');
  }

  // `INSERT IGNORE` contra el UNIQUE: repetir el alta no es un error, es la
  // misma suscripción. Y no se re-abre una ya avisada — si se hiciera,
  // apretar el botón después de recibir el aviso pediría el mismo aviso otra
  // vez sin que haya pasado nada nuevo.
  await tx.execute(
    sql`INSERT IGNORE INTO \`stock_alerts\` (\`variant_id\`, \`phone\`) VALUES (${input.variantId}, ${phone})`,
  );
}

/**
 * Les avisa a quienes esperaban esta variante. **No tira nunca.**
 *
 * Se la llama sin `await` después del commit que subió el stock (ver
 * `adjustStock` y `catalog-import`), así que un Meta caído no puede hacer
 * fallar un ajuste de inventario.
 *
 * Devuelve cuántas se marcaron y cuántas salieron: la diferencia son los
 * avisos que se perdieron, y queda en el log. Se aceptan perdidos a propósito
 * — ver la regla 2 de arriba.
 */
export async function notifyBackInStock(
  variantId: number,
  options: { notifier?: StockAlertNotifier | null; executor?: Executor } = {},
): Promise<{ marcadas: number; enviadas: number }> {
  try {
    const notifier =
      options.notifier === undefined ? resolveStockAlertNotifier() : options.notifier;
    if (!notifier) return { marcadas: 0, enviadas: 0 };

    const tx = options.executor ?? getDb();

    // Se relee la disponibilidad acá adentro y no se confía en quien llamó:
    // entre el commit que subió el stock y esta línea, otra compradora pudo
    // llevarse la última unidad. Avisar de un stock que ya no está es peor
    // que no avisar.
    if ((await getAvailability(variantId, tx)) <= 0) return { marcadas: 0, enviadas: 0 };

    const producto = await datosDelProducto(variantId, tx);
    if (!producto) return { marcadas: 0, enviadas: 0 };

    const pendientes = await tx
      .select({ id: stockAlerts.id, phone: stockAlerts.phone })
      .from(stockAlerts)
      .where(and(eq(stockAlerts.variantId, variantId), isNull(stockAlerts.notifiedAt)))
      .orderBy(stockAlerts.createdAt)
      .limit(NOTIFY_BATCH);

    if (pendientes.length === 0) return { marcadas: 0, enviadas: 0 };

    const body = backInStockBody(producto, await nombreTienda());
    let marcadas = 0;
    let enviadas = 0;

    for (const suscripcion of pendientes) {
      // Marcar primero, con `WHERE notified_at IS NULL`, y confirmar leyendo:
      // dos corridas simultáneas (el ajuste y el barrido del cron) corren la
      // misma sentencia y sólo una toca la fila. La que no la tocó no manda.
      await tx
        .update(stockAlerts)
        .set({ notifiedAt: new Date() })
        .where(and(eq(stockAlerts.id, suscripcion.id), isNull(stockAlerts.notifiedAt)));

      const confirmacion = await tx
        .select({ notifiedAt: stockAlerts.notifiedAt })
        .from(stockAlerts)
        .where(and(eq(stockAlerts.id, suscripcion.id), isNotNull(stockAlerts.notifiedAt)))
        .limit(1);
      if (confirmacion.length === 0) continue;

      marcadas += 1;

      try {
        await withTimeout(
          notifier.sender.send({
            to: suscripcion.phone,
            body,
            templateName: notifier.templateName,
          }),
          AVISO_TIMEOUT_MS,
        );
        enviadas += 1;
      } catch (error) {
        // La fila queda marcada igual: ver la regla 2. Se pierde este aviso y
        // no se reintenta — reintentar es la forma más rápida de mandarle
        // diez mensajes a la misma persona.
        log.error(`avisoStock: no se pudo avisar de la variante ${variantId}`, { error: mensajeDe(error) });
      }
    }

    if (marcadas !== enviadas) {
      log.warn(`avisoStock: ${marcadas - enviadas} aviso(s) perdido(s) de ${variantId}`);
    }

    return { marcadas, enviadas };
  } catch (error) {
    // Último cinturón: esto corre sin `await` detrás de un ajuste de stock ya
    // commiteado, y no puede hacer ruido en quien lo disparó.
    log.error('notifyBackInStock falló entero', { error: mensajeDe(error) });
    return { marcadas: 0, enviadas: 0 };
  }
}

/**
 * El barrido del cron: variantes con suscripciones pendientes que hoy tienen
 * stock.
 *
 * Existe por un caso que el disparo post-ajuste no cubre: una reserva que
 * vence libera disponibilidad sin que nadie ajuste nada, así que no hay
 * ninguna escritura detrás de la cual colgarse. Sin este barrido, esas
 * suscripciones esperan hasta el próximo ajuste manual.
 */
export async function sweepBackInStock(
  options: { notifier?: StockAlertNotifier | null; executor?: Executor; limit?: number } = {},
): Promise<{ variantes: number; enviadas: number }> {
  const notifier = options.notifier === undefined ? resolveStockAlertNotifier() : options.notifier;
  if (!notifier) return { variantes: 0, enviadas: 0 };

  const tx = options.executor ?? getDb();

  const conPendientes = await tx
    .selectDistinct({ variantId: stockAlerts.variantId })
    .from(stockAlerts)
    .where(isNull(stockAlerts.notifiedAt))
    .limit(options.limit ?? NOTIFY_BATCH);

  let variantes = 0;
  let enviadas = 0;
  for (const fila of conPendientes) {
    const resultado = await notifyBackInStock(fila.variantId, { notifier, executor: tx });
    if (resultado.marcadas > 0) {
      variantes += 1;
      enviadas += resultado.enviadas;
    }
  }

  return { variantes, enviadas };
}

/**
 * Borra las suscripciones ya avisadas de hace más de 90 días. La llama
 * `runMaintenance`.
 *
 * Las avisadas y sólo ésas: una suscripción sin avisar todavía es una promesa
 * pendiente, por vieja que sea.
 */
export async function purgeNotifiedStockAlerts(
  now: Date = new Date(),
  executor?: Executor,
): Promise<number> {
  const tx = executor ?? getDb();
  const limite = new Date(now.getTime() - PURGE_AFTER_DAYS * 24 * 3600_000);

  // El driver de mysql2 devuelve `[ResultSetHeader, FieldPacket[]]`, así que
  // `affectedRows` está en el primer elemento y no en el objeto de arriba.
  const result = await tx
    .delete(stockAlerts)
    .where(and(isNotNull(stockAlerts.notifiedAt), lt(stockAlerts.notifiedAt, limite)));

  const header = (result as unknown as Array<{ affectedRows?: number }>)[0];
  return Number(header?.affectedRows ?? 0);
}

export type BackInStockProduct = { productName: string; label: string; slug: string };

/** El texto del aviso. Separado del envío para testearlo sin red. */
export function backInStockBody(producto: BackInStockProduct, tienda: string = TIENDA.nombre): string {
  const lineas = [
    t('wa.stock.disponible', {
      producto: producto.productName,
      etiqueta: producto.label,
      tienda,
    }),
  ];

  // Sin `NEXT_PUBLIC_SITE_URL` no hay link absoluto, y un `/producto/x` en
  // WhatsApp no es clickeable: sale sin la línea en vez de con una a medias.
  const origin = siteOrigin();
  if (origin) {
    lineas.push(t('wa.stock.verProducto', { url: `${origin.origin}/producto/${producto.slug}` }));
  }

  return lineas.join('\n');
}

async function datosDelProducto(
  variantId: number,
  tx: Executor,
): Promise<BackInStockProduct | null> {
  const filas = await tx
    .select({ productName: products.name, label: variants.label, slug: products.slug })
    .from(variants)
    .innerJoin(products, eq(variants.productId, products.id))
    .where(eq(variants.id, variantId))
    .limit(1);
  return filas[0] ?? null;
}
