"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";

import { findOrderByNumberAndPhone, orderUrl } from "@/domain/order-access";
import { t, tPlural } from "@/i18n";
import {
  LOOKUP_LIMIT,
  LOOKUP_WINDOW_MS,
  clientIp,
  rateLimit,
} from "@/lib/rate-limit";
import { normalizePhonePY } from "@/lib/py";
import {
  createWhatsappCloudSender,
  whatsappCloudConfig,
} from "@/domain/messaging/whatsapp-cloud";
import { cargarIntegraciones } from "@/lib/integraciones-store";
import { valorIntegracion } from "@/lib/integraciones";
import { withTimeout } from "@/domain/notify-timing";
import { log, mensajeDe } from "@/lib/log";
import { currentCustomer } from "@/lib/customer-session";
import { findCustomerById } from "@/domain/customers";
import { cuentasClientesHabilitadas } from "@/lib/cuentas";

/**
 * Búsqueda del pedido por número + teléfono (PLAN.md 3.9).
 *
 * Dos reglas, las dos para que esto no sirva de enumerador:
 * 1. rate limit de 5 intentos por IP cada 15 minutos;
 * 2. un único mensaje de error, igual para "no existe", "el teléfono no
 *    coincide" y "el formato está mal". Cualquier diferencia convierte el
 *    formulario en un oráculo de números de pedido válidos.
 */

/**
 * Una función y no una constante: `t()` se resuelve al importar el módulo, y
 * una constante de módulo la congelaría antes de que nadie la pida. Cuesta
 * nada y evita el bug tonto del día que el catálogo se elija en runtime.
 */
const genericError = (): string => t("error.buscarPedido.noEncontrado");

const LookupSchema = z.object({
  orderNumber: z.string().trim().min(3).max(16),
  phone: z.string().trim().min(6).max(30),
});

export type LookupResult =
  | { ok: true; redirectTo: string }
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function lookupOrder(input: unknown): Promise<LookupResult> {
  const ip = clientIp(await headers());
  const limit = rateLimit(`lookup:${ip}`, {
    limit: LOOKUP_LIMIT,
    windowMs: LOOKUP_WINDOW_MS,
  });

  if (!limit.ok) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return {
      ok: false,
      error: tPlural("error.buscarPedido.demasiados", minutes),
    };
  }

  const parsed = LookupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: genericError() };
  }

  const phone = normalizePhonePY(parsed.data.phone);
  const number = parsed.data.orderNumber.toUpperCase();
  const options = { limit: LOOKUP_LIMIT, windowMs: LOOKUP_WINDOW_MS };
  const generic = {
    ok: true as const,
    message: t("buscarPedido.recuperacion"),
  };
  if (
    !phone ||
    !rateLimit(`lookup:phone:${phone}`, options).ok ||
    !rateLimit(`lookup:order:${number}`, options).ok
  )
    return generic;
  const found = await findOrderByNumberAndPhone(number, phone);
  await cargarIntegraciones();
  const templateName = valorIntegracion("whatsapp", "plantillaRecuperarPedido");
  const config = templateName ? whatsappCloudConfig(templateName) : null;
  if (config) {
    if (found)
      after(async () => {
        try {
          await withTimeout(
            createWhatsappCloudSender(config).send({
              to: phone,
              body: orderUrl(
                found.orderNumber,
                found.accessToken,
                process.env.NEXT_PUBLIC_SITE_URL ?? ""
              ),
            }),
            12_000
          );
        } catch (error) {
          log.error("Order recovery delivery failed", {
            error: mensajeDe(error),
          });
        }
      });
    return generic;
  }
  // A public phone number is not an access credential. Without messaging,
  // only an already verified account may receive the link in the response.
  const actor = (await cuentasClientesHabilitadas())
    ? await currentCustomer()
    : null;
  const account = actor ? await findCustomerById(actor.customerId) : null;
  if (found && account?.phoneVerifiedAt && account.phone === phone) {
    return {
      ok: true,
      redirectTo: orderUrl(found.orderNumber, found.accessToken),
    };
  }
  return generic;
}
