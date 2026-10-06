import {
  MessageSendError,
  type MessageSender,
  type OutgoingMessage,
} from "./sender";
import { log, mensajeDe } from "@/lib/log";
import { integracion, valorIntegracion } from "@/lib/integraciones";

/**
 * WhatsApp Cloud API de Meta (PLAN.md FASE 2, PR F.2).
 *
 * **Lo que una tienda nueva tiene que conseguir antes de poder prender esto**,
 * y es el motivo por el que el login sin contraseña viene pre-armado pero
 * apagado:
 *
 * 1. Una app de Meta for Developers con el producto WhatsApp agregado.
 * 2. Un número de teléfono verificado por Meta (no sirve el WhatsApp común del
 *    comercio: tiene que estar dado de alta en la plataforma).
 * 3. Un token de acceso permanente (los de prueba duran 24 h).
 * 4. Una **plantilla de mensaje aprobada** por Meta. Fuera de la ventana de 24
 *    horas desde el último mensaje de la persona, Meta no deja mandar texto
 *    libre: sólo plantillas que revisó. Un código de login siempre cae fuera
 *    de esa ventana, así que la plantilla no es opcional.
 *
 * El paso 4 es el que sorprende y el que tarda: la aprobación puede demorar
 * días. Está en `docs/ENV-OPCIONAL.md` y en NEW-STORE.md.
 */
export const WHATSAPP_TEMPLATE_LANGUAGE = "es";

/** La versión de la Graph API cuando la tienda no eligió otra. */
export const WHATSAPP_API_VERSION_DEFAULT = "v21.0";

export type WhatsappCloudConfig = {
  phoneNumberId: string;
  accessToken: string;
  /** Nombre de la plantilla aprobada por Meta. */
  templateName: string;
  apiVersion: string;
};

/**
 * Lee la configuración: `/admin/integraciones` → WhatsApp, o si no el
 * entorno (`src/lib/integraciones.ts`). Devuelve `null` si falta cualquier cosa —
 * "configurado a medias" es lo mismo que "no configurado", porque una llamada
 * con la mitad de las credenciales falla igual pero más tarde y peor.
 */
export function whatsappCloudConfig(
  templateOverride?: string
): WhatsappCloudConfig | null {
  const { valores } = integracion("whatsapp");
  const { phoneNumberId, accessToken } = valores;
  const templateName = templateOverride ?? valores.plantillaLogin;

  if (!phoneNumberId || !accessToken || !templateName) return null;

  return {
    phoneNumberId,
    accessToken,
    templateName,
    apiVersion: valores.apiVersion || WHATSAPP_API_VERSION_DEFAULT,
  };
}

/**
 * La plantilla del aviso de pedido nuevo al comercio, o `null` si esta tienda
 * no la pidió todavía.
 *
 * Es una variable aparte de `WHATSAPP_CLOUD_TEMPLATE_NAME` porque Meta aprueba
 * una plantilla por mensaje: la del login ya está aprobada en las tiendas que
 * usan login sin contraseña, y ésta hay que pedirla de nuevo. Sin ella, el
 * aviso queda apagado y el resto de la tienda no cambia en nada.
 */
export function whatsappOwnerTemplate(): string | null {
  return valorIntegracion("whatsapp", "plantillaPedidoNuevo");
}

export function createWhatsappCloudSender(
  config: WhatsappCloudConfig
): MessageSender {
  return {
    channel: "whatsapp",
    label: "WhatsApp",

    async send(message: OutgoingMessage): Promise<{ messageId?: string }> {
      const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;

      // Plantilla y no `type: "text"`: fuera de la ventana de 24 h Meta
      // rechaza el texto libre, y un código de login siempre está fuera.
      const payload = {
        messaging_product: "whatsapp",
        // Meta quiere el número sin `+`.
        to: message.to.replace(/^\+/, ""),
        type: "template",
        template: {
          // Cada mensaje con la suya: el aviso al dueño no puede salir con la
          // plantilla del código de login (ver `OutgoingMessage.templateName`).
          name: message.templateName?.trim() || config.templateName,
          language: { code: WHATSAPP_TEMPLATE_LANGUAGE },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: message.body }],
            },
          ],
        },
      };

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        // El detalle al log del servidor; hacia afuera, nada. El mensaje de
        // error de Meta puede incluir el número de destino.
        log.error("WhatsApp Cloud: la llamada falló", {
          error: mensajeDe(error),
        });
        throw new MessageSendError("No pudimos mandar el mensaje.");
      }

      if (!response.ok) {
        log.error("WhatsApp Cloud rechazó el envío", {
          status: response.status,
        });
        throw new MessageSendError(
          "No pudimos mandar el mensaje.",
          response.status < 500 ? "rejected" : "unknown"
        );
      }
      const result = (await response.json()) as {
        messages?: Array<{ id?: string }>;
      };
      return { messageId: result.messages?.[0]?.id };
    },
  };
}
