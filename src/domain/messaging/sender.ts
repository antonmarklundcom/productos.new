/**
 * Por dónde le mandamos un mensaje a una compradora (PLAN.md FASE 2, PR F.2).
 *
 * La interfaz existe antes que cualquier proveedor real, y a propósito: el
 * login sin contraseña, los avisos de "pedido enviado" y los carritos
 * abandonados son todos el mismo problema —mandar un mensaje— y no conviene
 * tener tres integraciones distintas cuando llegue el momento.
 *
 * **La regla de esta fase: sin credenciales, la opción no se ofrece.** Un
 * botón de "mandame un código" que no puede mandar nada es peor que no
 * tenerlo: quien lo aprieta se queda esperando un mensaje que no va a llegar y
 * no sabe si el problema es suyo.
 */

export type MessageChannel = "whatsapp" | "consola";

export type OutgoingMessage = {
  /** `+595XXXXXXXXX`, ya normalizado. */
  to: string;
  body: string;
  /**
   * Plantilla de Meta a usar, cuando no es la de siempre.
   *
   * Existe porque hay **dos** mensajes con dueños distintos: el código de login
   * que recibe la compradora y el aviso de pedido nuevo que recibe el comercio.
   * Meta aprueba plantillas de a una, así que son dos nombres distintos y cada
   * uno se pide por separado. Sin esto, el aviso al dueño saldría con la
   * plantilla del login y Meta lo rechazaría —o peor, lo mandaría con el texto
   * equivocado.
   *
   * Vacío = la plantilla por defecto del sender (`WHATSAPP_CLOUD_TEMPLATE_NAME`).
   * Los senders que no usan plantillas (la consola) lo ignoran.
   */
  templateName?: string;
};

export interface MessageSender {
  readonly channel: MessageChannel;
  /** Nombre para mostrarle a la persona: "WhatsApp". */
  readonly label: string;
  send(message: OutgoingMessage): Promise<void | { messageId?: string }>;
}

export class MessageSendError extends Error {
  constructor(
    message: string,
    readonly outcome: "rejected" | "unknown" = "unknown"
  ) {
    super(message);
    this.name = "MessageSendError";
  }
}
