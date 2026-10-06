"use server";

import { safeError } from "@/lib/safe-error";

import { headers } from "next/headers";
import { z } from "zod";

import { StockAlertError, subscribeStockAlert } from "@/domain/stock-alerts";
import { t } from "@/i18n";
import { normalizePhonePY } from "@/lib/py";
import {
  STOCK_ALERT_IP_LIMIT,
  STOCK_ALERT_IP_WINDOW_MS,
  STOCK_ALERT_PHONE_LIMIT,
  STOCK_ALERT_PHONE_WINDOW_MS,
  clientIp,
  rateLimit,
} from "@/lib/rate-limit";

/**
 * "Avisame cuando haya stock", desde la vidriera (O6, plan-operacion §5.2 E).
 *
 * **Es pública**: no hay sesión detrás, la llama una compradora que ni siquiera
 * tiene cuenta. Eso cambia dos cosas respecto de las acciones de `/admin`:
 *
 * 1. **El rate limit es la única puerta.** Por IP (el formulario es público y
 *    sin captcha) y por teléfono (cada aviso es un WhatsApp que le llega a una
 *    persona real y que paga el comercio). Ver `rate-limit.ts`.
 * 2. **La respuesta no distingue casos.** Sale el mismo "listo" tanto si la
 *    suscripción se creó como si ya existía. Distinguirlos convierte el
 *    formulario en un oráculo de "¿este número está anotado acá?", que es
 *    información de una persona que no la dio para eso.
 *
 * Lo único que viaja desde el navegador es la variante y el teléfono: si hay
 * stock, cómo se llama el producto y si la variante está publicada lo decide
 * el servidor releyendo la base.
 */

const SubscribeSchema = z.object({
  variantId: z.number().int().positive(),
  // El `.max()` es el largo de la columna (`varchar(20)`); el formato real lo
  // valida `normalizePhonePY`, que es el mismo validador del checkout.
  phone: z.string().trim().min(1).max(20),
});

export type StockAlertResult = { ok: true } | { ok: false; error: string };

export async function subscribeToStockAlert(
  input: unknown
): Promise<StockAlertResult> {
  try {
    const parsed = SubscribeSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: t("error.checkout.telefono") };
    }

    const ip = clientIp(await headers());
    if (
      !rateLimit(`avisoStock:ip:${ip}`, {
        limit: STOCK_ALERT_IP_LIMIT,
        windowMs: STOCK_ALERT_IP_WINDOW_MS,
      }).ok
    ) {
      return { ok: false, error: t("error.avisoStock.demasiados") };
    }

    // El límite por teléfono se cuenta sobre el número **normalizado**: sin
    // eso, `0981 123 456` y `+595981123456` serían dos cubetas distintas para
    // el mismo aparato, y el freno no frenaría nada.
    const phone = normalizePhonePY(parsed.data.phone);
    if (!phone) return { ok: false, error: t("error.checkout.telefono") };

    if (
      !rateLimit(`avisoStock:tel:${phone}`, {
        limit: STOCK_ALERT_PHONE_LIMIT,
        windowMs: STOCK_ALERT_PHONE_WINDOW_MS,
      }).ok
    ) {
      return { ok: false, error: t("error.avisoStock.demasiados") };
    }

    await subscribeStockAlert({ variantId: parsed.data.variantId, phone });
    return { ok: true };
  } catch (error) {
    // Los errores de dominio están escritos para la compradora ("ya hay
    // stock", "ese producto ya no está") y se muestran tal cual. Cualquier
    // otra cosa sale genérica y el detalle queda en el log del servidor.
    if (error instanceof StockAlertError) {
      return { ok: false, error: error.message };
    }
    console.error("subscribeToStockAlert falló", safeError(error).message);
    return { ok: false, error: t("error.avisoStock.apagado") };
  }
}
