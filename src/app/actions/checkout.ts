"use server";

import { safeError } from "@/lib/safe-error";

import { headers } from "next/headers";
import { z } from "zod";

import {
  CheckoutError,
  TotalChangedError,
  createOrder,
} from "@/domain/create-order";
import { orderUrl } from "@/domain/order-access";
import {
  isPagoparConfigured,
  pagoparCheckoutUrl,
} from "@/domain/pagopar/config";
import { startPagoparCheckout } from "@/domain/pagopar/checkout";
import { DOC_TYPES, PAYMENT_METHODS } from "@/db/schema";
import type { CartIssue } from "@/lib/cart-issues";
import { t } from "@/i18n";
import { currentCustomer } from "@/lib/customer-session";
import {
  CHECKOUT_LIMIT,
  CHECKOUT_WINDOW_MS,
  clientIp,
  rateLimit,
} from "@/lib/rate-limit";
import { cargarIntegraciones } from "@/lib/integraciones-store";

/**
 * Server action del checkout.
 *
 * Recibe el carrito del navegador y devuelve la URL tokenizada del pedido.
 * Los montos no viajan en el input: los calcula `createOrder` desde la DB.
 *
 * Es una acción **pública** —los compradores son anónimos, ARCH.md §1 regla 3—
 * así que no hay sesión que verificar. Lo que sí hay es un límite por IP: cada
 * pedido creado reserva stock por 45 minutos o 24 horas sin que nadie haya
 * pagado nada, y un script sin freno deja la vidriera en "sin stock" gratis.
 */

const CheckoutActionSchema = z.object({
  operationKey: z.uuid(),
  items: z
    .array(
      z.object({
        variantId: z.number().int().positive(),
        qty: z.number().int().min(1).max(99),
      })
    )
    .min(1, "El carrito está vacío"),
  customerName: z.string().trim().min(3, "Poné tu nombre completo").max(160),
  customerPhone: z.string().trim().min(6, "Falta tu WhatsApp").max(30),
  // Opcional de verdad: vacío es lo normal y se guarda como NULL. Lo que no
  // pasa es un email mal escrito — desde que el campo se renderiza (PR A.3)
  // esta columna recibe lo que tipeó una persona, y un "juan@" guardado es un
  // dato que nadie va a poder usar el día que el WhatsApp falle.
  customerEmail: z
    .union([
      z.literal(""),
      z.email("Revisá el email: parece incompleto").max(200),
    ])
    .optional(),
  docType: z.enum(DOC_TYPES),
  docNumber: z.string().trim().max(32).optional().or(z.literal("")),
  isConsumidorFinal: z.boolean(),
  shipCity: z.string().trim().min(2, "Falta la ciudad").max(120),
  shipBarrio: z.string().trim().max(120).optional().or(z.literal("")),
  shipAddress: z.string().trim().min(5, "Falta la dirección").max(255),
  shipReference: z.string().trim().max(255).optional().or(z.literal("")),
  paymentMethod: z.enum(PAYMENT_METHODS),
  // El **id** del método de envío elegido, nunca su precio: `createOrder` lo
  // re-valida y lo re-cotiza contra la DB adentro de su transacción. Ausente
  // = no eligió (una tienda sin métodos configurados, o un checkout viejo).
  shippingMethodId: z.number().int().positive().optional(),
  // Ausente = no se preguntó (un POST viejo, o el formulario sin la casilla).
  // No se completa con `false`: ver `orders.marketing_opt_in`.
  /** El código tipeado. El descuento lo calcula el servidor (PR G). */
  couponCode: z.string().trim().max(40).optional(),
  marketingOptIn: z.boolean().optional(),
  isGift: z.boolean().optional(),
  giftNote: z.string().trim().max(300).optional().or(z.literal("")),
  // El total que el navegador venía mostrando. Se compara contra el que
  // calcula la DB para poder avisar que cambió; nunca se cobra (ver
  // `CreateOrderInput.expectedTotalPyg`).
  expectedTotalPyg: z.number().int().nonnegative().optional(),
});

export type CheckoutResult =
  | { ok: true; orderNumber: string; redirectTo: string }
  | {
      ok: false;
      error: string;
      issues?: CartIssue[];
      /**
       * El total cambió mientras completaba el formulario. No se creó nada:
       * la pantalla muestra el número nuevo y ella confirma otra vez.
       */
      totalChanged?: { before: number; after: number };
    };

export async function submitCheckout(input: unknown): Promise<CheckoutResult> {
  // Pagopar puede estar configurado desde /admin/integraciones.
  await cargarIntegraciones();
  // Antes de mirar el cuerpo: lo caro de este endpoint no es validarlo sino la
  // transacción que reserva stock al final.
  const ip = clientIp(await headers());
  if (
    !rateLimit(`checkout:${ip}`, {
      limit: CHECKOUT_LIMIT,
      windowMs: CHECKOUT_WINDOW_MS,
    }).ok
  ) {
    return { ok: false, error: t("error.checkout.demasiadosIntentos") };
  }

  const parsed = CheckoutActionSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first?.message ?? t("error.checkout.revisaDatos"),
    };
  }

  // El form ya lo oculta si no está configurado; esto es el guard del lado
  // servidor para quien lo intente igual con un POST directo.
  if (parsed.data.paymentMethod === "tarjeta" && !isPagoparConfigured()) {
    return { ok: false, error: t("error.checkout.sinTarjeta") };
  }

  try {
    // La cuenta sale de **la cookie**, no del formulario: un `customerId` que
    // viaje en el input deja atar la compra propia a la cuenta de cualquiera.
    // Sin sesión —el checkout de invitado, que es el camino principal— queda
    // null y el pedido es exactamente el de siempre.
    const customer = await currentCustomer();

    const order = await createOrder({
      ...parsed.data,
      customerId: customer?.customerId ?? null,
      couponCode: parsed.data.couponCode || null,
      customerEmail: parsed.data.customerEmail || null,
      docNumber: parsed.data.docNumber || null,
      shipBarrio: parsed.data.shipBarrio || null,
      shipReference: parsed.data.shipReference || null,
      giftNote: parsed.data.giftNote || null,
    });

    /*
      El aviso al comercio (fable/plan.md §5.2).

      Va acá, después del commit de `createOrder` y **sin await**: la compradora
      ya tiene su pedido guardado y su link, así que nada de lo que pase con
      Meta puede quitárselos. `notifyOwnerNewOrder` no tira nunca —atrapa todo
      adentro y lo anota en `order_events`—, pero el `.catch()` queda igual: un
      rechazo sin manejar en una promesa suelta tumba el proceso de Node, que es
      el único slot de la tienda.

      También para tarjeta, y a propósito: al dueño le sirve saber que entró un
      pedido aunque todavía no esté pagado, y el método viaja en el texto.
    */
    // Owner notices move to createOrder's committed outbox with customer notices.

    if (parsed.data.paymentMethod === "tarjeta") {
      // El pedido y la reserva de stock (45 min, RESERVATION_TTL_MINUTES.tarjeta)
      // ya quedaron escritos por `createOrder`; acá sólo se abre la transacción
      // en Pagopar y se manda al comprador a pagar.
      try {
        const started = await startPagoparCheckout(order.orderId);
        return {
          ok: true,
          orderNumber: order.orderNumber,
          redirectTo: pagoparCheckoutUrl(started.hashPedido),
        };
      } catch (pagoparError) {
        console.error(
          "startPagoparCheckout falló",
          safeError(pagoparError).message
        );
        // El pedido y su reserva de 45 min ya quedaron escritos: no se pierden
        // por un error de red con Pagopar. Mandamos al comprador a la página
        // de su pedido en vez de a un checkout roto; desde ahí puede
        // contactar al comercio para reintentar.
        return {
          ok: true,
          orderNumber: order.orderNumber,
          redirectTo: orderUrl(order.orderNumber, order.accessToken),
        };
      }
    }

    return {
      ok: true,
      orderNumber: order.orderNumber,
      redirectTo: orderUrl(order.orderNumber, order.accessToken),
    };
  } catch (error) {
    // Antes que CheckoutError: es una subclase suya.
    if (error instanceof TotalChangedError) {
      return {
        ok: false,
        error: error.message,
        totalChanged: { before: error.before, after: error.after },
      };
    }
    if (error instanceof CheckoutError) {
      return { ok: false, error: error.message, issues: error.issues };
    }
    // El detalle queda en el log del servidor; al comprador no le sirve.
    console.error("createOrder falló", safeError(error).message);
    return { ok: false, error: t("error.checkout.generico") };
  }
}
