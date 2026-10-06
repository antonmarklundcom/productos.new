import type { MessageSender, OutgoingMessage } from './sender';
import { createWhatsappCloudSender, whatsappCloudConfig } from './whatsapp-cloud';

export type { MessageChannel, MessageSender, OutgoingMessage } from './sender';
export { MessageSendError } from './sender';
export { whatsappCloudConfig, whatsappOwnerTemplate } from './whatsapp-cloud';

/**
 * El sender de dev: imprime el mensaje en la consola del servidor.
 *
 * **Nunca en producción.** `resolveMessageSender` se niega a devolverlo con
 * `NODE_ENV=production`, y el motivo es directo: acá adentro viaja un código
 * que abre la sesión de una compradora, y los logs de un hosting compartido no
 * son un lugar privado.
 */
export function createConsoleSender(): MessageSender {
  return {
    channel: 'consola',
    label: 'consola del servidor',
    async send(message: OutgoingMessage): Promise<void> {
      console.log(`\n📲 [dev] mensaje para ${message.to}:\n   ${message.body}\n`);
    },
  };
}

/**
 * Qué sender usar, o `null` si esta tienda no puede mandar mensajes.
 *
 * `null` es una respuesta legítima y es la de **la mayoría** de las tiendas
 * hoy: sin credenciales de Meta no hay forma de mandar nada, y el login sólo
 * ofrece contraseña. Quien llame a esto tiene que estar preparado para el
 * null; ése es todo el mecanismo que apaga la feature.
 */
export function resolveMessageSender(): MessageSender | null {
  const config = whatsappCloudConfig();
  if (config) return createWhatsappCloudSender(config);

  // En dev, la consola alcanza para recorrer el flujo entero sin cuenta de
  // Meta. En producción no existe: mejor sin feature que con los códigos de
  // acceso en el log.
  if (process.env.NODE_ENV !== 'production') return createConsoleSender();

  return null;
}

/** ¿Esta tienda puede ofrecer el login sin contraseña? */
export function messagingConfigured(): boolean {
  return resolveMessageSender() !== null;
}
