"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { priceCart } from "@/domain/cart";
import { waLinkPublico } from "@/lib/comercio";
import { formatGs } from "@/lib/money";
import { QUOTE_LIMIT, QUOTE_WINDOW_MS, clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * "Consultar por WhatsApp" desde el carrito, con los ítems y el total ya
 * escritos en el mensaje.
 *
 * La ficha de producto ya tenía este botón; el carrito no, y es donde más
 * falta hace — la duda que frena una compra ("¿me llega antes del sábado?")
 * aparece con el carrito armado, y hacerle escribir de nuevo qué quería es
 * perder la venta.
 *
 * Es una server action y no un link armado en el cliente porque el número
 * sale de los ajustes de la tienda o de `WHATSAPP_NUMBER`, una variable **del
 * servidor**: no lleva `NEXT_PUBLIC_` a propósito (ver `src/lib/comercio.ts`).
 * De paso, el total del mensaje sale de la DB y no del snapshot del
 * navegador, así que el comercio recibe el precio que va a cobrar.
 *
 * No crea nada ni reserva stock: es una consulta.
 */

const ConsultaSchema = z.array(
  z.object({
    variantId: z.number().int().positive(),
    qty: z.number().int().min(1).max(99),
  })
);

export async function cartWhatsAppLink(input: unknown): Promise<string | null> {
  const ip = clientIp(await headers());
  if (!rateLimit(`consulta:${ip}`, { limit: QUOTE_LIMIT, windowMs: QUOTE_WINDOW_MS }).ok) {
    return null;
  }

  const parsed = ConsultaSchema.safeParse(input);
  if (!parsed.success || parsed.data.length === 0) return null;

  const cart = await priceCart(parsed.data);
  if (cart.lines.length === 0) return null;

  const items = cart.lines
    .map((line) => `• ${line.qty} × ${line.name} — ${line.variantLabel}`)
    .join("\n");

  // El envío no entra: sin ciudad no hay zona, y un total que después sube es
  // peor que un total que se aclara.
  const message =
    `¡Hola! Tengo una consulta sobre este carrito:\n${items}\n\n` +
    `Total sin envío: ${formatGs(cart.subtotalPyg)}`;

  // `waLink` recorta el texto largo antes de codificarlo: un carrito de
  // veinte líneas no rompe el deeplink, se acorta.
  return waLinkPublico(message);
}
