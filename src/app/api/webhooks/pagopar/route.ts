import { pagoparPrivateKey } from "@/domain/pagopar/config";
import { tokensMatch, webhookGuardToken } from "@/domain/pagopar/hash";
import {
  parseWebhookEvent,
  webhookErrorBody,
  webhookResponseBody,
  type PagoparWebhookEvent,
} from "@/domain/pagopar/protocol";
import {
  PagoparAmountMismatchError,
  processPagoparWebhook,
  UnknownPagoparOrderError,
  withDeadline,
} from "@/domain/pagopar/webhook";
import {
  clientIp,
  PAGOPAR_WEBHOOK_LIMIT,
  PAGOPAR_WEBHOOK_WINDOW_MS,
  rateLimit,
} from "@/lib/rate-limit";
import { log, mensajeDe } from '@/lib/log';
import { cargarIntegraciones } from '@/lib/integraciones-store';

/**
 * Aviso de pago de Pagopar (PLAN.md 5.2, ARCH.md §4).
 *
 *   POST /api/webhooks/pagopar?token=sha1(PRIVATE_KEY + hash_pedido)
 *
 * Esta ruta es pública y mueve pedidos a `pagado`. Lo único que la separa de
 * cualquiera en internet es esa firma, así que el orden importa: firma →
 * idempotencia → monto → transición. Nada de trabajo antes de la firma.
 *
 * Presupuesto de respuesta: Pagopar reintenta si tardamos más de ~5 s
 * (ARCH.md §4). Ver `DEADLINE_MS`.
 */

// Lee y escribe la base en cada llamada: nunca se prerenderiza.
export const dynamic = "force-dynamic";
// `node:crypto` (sha1 + timingSafeEqual) no existe en el runtime edge.
export const runtime = "nodejs";

/**
 * Corte propio, por debajo del de Pagopar.
 *
 * Si la base se pone lenta preferimos contestar 500 —que Pagopar reintenta— a
 * que nos corte a los 5 s. Soltar el trabajo a mitad de camino es seguro
 * porque el evento y la transición viajan en la MISMA transacción: o commitea
 * entera (y el reintento la ve como repetida) o vuelve atrás (y el reintento
 * la rehace). Nunca queda un pedido a medio cobrar.
 */
const DEADLINE_MS = 4_000;

export async function POST(request: Request): Promise<Response> {
  // La clave puede venir de /admin/integraciones: se asegura la foto fresca
  // antes de leerla. Sin clave en ninguna fuente, 503 como siempre.
  await cargarIntegraciones();
  const privateKey = pagoparPrivateKey();
  if (!privateKey) {
    // Sin clave no se puede verificar nada, y una ruta de pagos que acepta
    // cualquier cosa "hasta que la configuren" es una ruta abierta.
    log.error('pagopar: falta la configuración; el webhook queda cerrado');
    return json(webhookErrorBody("not_configured"), 503);
  }

  const ip = clientIp(request.headers);
  if (
    !rateLimit(`pagopar:${ip}`, {
      limit: PAGOPAR_WEBHOOK_LIMIT,
      windowMs: PAGOPAR_WEBHOOK_WINDOW_MS,
    }).ok
  ) {
    // 429 es reintentable: un aviso legítimo atrapado acá vuelve.
    return json(webhookErrorBody("rate_limited"), 429);
  }

  let event: PagoparWebhookEvent;
  try {
    event = parseWebhookEvent(await request.json());
  } catch {
    // El cuerpo no se loguea: trae datos del comprador.
    log.warn('pagopar: aviso con un cuerpo que no pude interpretar');
    return json(webhookErrorBody("invalid_payload"), 400);
  }

  if (!guardMatches(request, privateKey, event.hashPedido)) {
    // Un solo mensaje: distinguir "falta el token" de "el token está mal" ya
    // es información gratis. No se loguea ni el valor recibido ni el esperado.
    log.warn('pagopar: aviso con firma inválida, descartado');
    return json(webhookErrorBody("unauthorized"), 401);
  }

  try {
    const outcome = await withDeadline(processPagoparWebhook(event), DEADLINE_MS);

    switch (outcome.kind) {
      case "aplicado":
        log.info("pagopar: pago acreditado", {
          pedido: outcome.orderNumber,
          cambio: outcome.changed,
        });
        break;
      case "repetido":
        log.info('pagopar: aviso repetido, sin cambios');
        break;
      case "no_pagado":
        log.info("pagopar: aviso de pago no acreditado", { pedido: outcome.orderNumber });
        break;
      case "sin_stock":
        // El peor caso que el sistema puede manejar solo: cobrado, sin
        // mercadería. Se contesta 200 porque reintentar no cambia nada; lo que
        // sigue es una devolución, y el panel ya lo lista en "pagos sin pedido
        // vivo" (ARCH.md §4.1).
        log.error("pagopar: pago tardío sin stock — queda cobrado, hay que devolver", {
          pedido: outcome.orderNumber,
          estado: outcome.status,
        });
        break;
      case "estado_final":
        // Puede ser inofensivo (`enviado`: ya se había cobrado) o grave
        // (`cancelado`: entró plata de un pedido que no existe más). El dueño
        // necesita verlo, y el número de pedido no es un secreto.
        log.error("pagopar: aviso de pago sobre un pedido que no lo espera — revisar a mano", {
          pedido: outcome.orderNumber,
          estado: outcome.status,
        });
        break;
    }

    return json(webhookResponseBody(event), 200);
  } catch (error) {
    if (error instanceof UnknownPagoparOrderError) {
      // Puede ser una carrera con `iniciar-transaccion`: 404 para que Pagopar
      // reintente cuando la fila de payments ya esté.
      log.warn('pagopar: aviso de un pedido que no reconozco');
      return json(webhookErrorBody("unknown_order"), 404);
    }

    if (error instanceof PagoparAmountMismatchError) {
      // No se transiciona nada. Los montos van al log porque son la única
      // forma de entender el descuadre; no son secretos.
      log.error("pagopar: monto distinto al del pedido", {
        pedido: error.orderNumber,
        esperado: error.expectedPyg,
        recibido: error.receivedPyg,
      });
      return json(webhookErrorBody("amount_mismatch"), 409);
    }

    log.error('pagopar: falló el procesamiento del aviso', { error: mensajeDe(error) });
    return json(webhookErrorBody("internal_error"), 500);
  }
}

/**
 * `sha1(PRIVATE_KEY + hash_pedido)`, comparado en tiempo constante contra el
 * token del querystring.
 *
 * Es una entrada distinta a la del token de `iniciar-transaccion` — dos
 * helpers separados a propósito (ver `domain/pagopar/hash.ts`).
 */
function guardMatches(request: Request, privateKey: string, hashPedido: string): boolean {
  const presented = new URL(request.url).searchParams.get("token") ?? "";
  if (presented === "") return false;
  return tokensMatch(webhookGuardToken(privateKey, hashPedido), presented);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
