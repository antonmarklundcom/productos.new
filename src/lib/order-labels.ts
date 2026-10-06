import type { OrderStatus, PaymentMethod } from "@/db/schema";
import { t } from "@/i18n";

/**
 * Los textos de la máquina de estados, en un solo archivo.
 *
 * Los ENUM de la DB están en snake_case y nadie los lee así. Hay **dos**
 * traducciones legítimas del mismo estado, y por eso conviven acá en vez de
 * unificarse en una: el panel dice qué tiene que hacer el dueño
 * ("Verificar comprobante"), y la página del pedido le cuenta al comprador
 * qué está pasando con su plata ("Comprobante en revisión"). Son el mismo
 * `esperando_verificacion` visto desde los dos lados del mostrador.
 *
 * Lo que sí era un problema es que vivieran en archivos distintos: agregar un
 * estado obligaba a acordarse del segundo mapa, y el que se olvidaba se
 * enteraba con un `undefined` en pantalla. Acá los dos `Record<OrderStatus,
 * string>` fallan el typecheck juntos.
 *
 * Desde el PR R los textos salen del catálogo (`estado.panel.*`,
 * `estado.comprador.*`). Este archivo queda igual y sigue siendo lo que fuerza
 * la decisión: los dos `Record<OrderStatus, string>` fallan el typecheck juntos
 * si alguien agrega un estado y se olvida de una de las dos vistas.
 */

/** Cómo lo lee el dueño en el panel: qué hay que hacer con este pedido. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pendiente_pago: t("estado.panel.pendiente_pago"),
  esperando_verificacion: t("estado.panel.esperando_verificacion"),
  pagado: t("estado.panel.pagado"),
  preparando: t("estado.panel.preparando"),
  enviado: t("estado.panel.enviado"),
  entregado: t("estado.panel.entregado"),
  rechazado: t("estado.panel.rechazado"),
  vencido: t("estado.panel.vencido"),
  cancelado: t("estado.panel.cancelado"),
  reembolsado: t("estado.panel.reembolsado"),
};

/** Cómo lo lee el comprador en `/pedido/[orderNumber]`: qué pasa con lo suyo. */
export const ORDER_STATUS_LABEL_COMPRADOR: Record<OrderStatus, string> = {
  pendiente_pago: t("estado.comprador.pendiente_pago"),
  esperando_verificacion: t("estado.comprador.esperando_verificacion"),
  pagado: t("estado.comprador.pagado"),
  preparando: t("estado.comprador.preparando"),
  enviado: t("estado.comprador.enviado"),
  entregado: t("estado.comprador.entregado"),
  rechazado: t("estado.comprador.rechazado"),
  vencido: t("estado.comprador.vencido"),
  cancelado: t("estado.comprador.cancelado"),
  reembolsado: t("estado.comprador.reembolsado"),
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  transferencia: t("metodo.transferencia"),
  contra_entrega: t("metodo.contra_entrega"),
  tarjeta: t("metodo.tarjeta"),
};

/** Verbo del botón que lleva a cada estado, en voseo. */
export const TRANSITION_LABEL: Partial<Record<OrderStatus, string>> = {
  pagado: t("transicion.pagado"),
  preparando: t("transicion.preparando"),
  enviado: t("transicion.enviado"),
  entregado: t("transicion.entregado"),
  cancelado: t("transicion.cancelado"),
  vencido: t("transicion.vencido"),
  rechazado: t("transicion.rechazado"),
  reembolsado: t("transicion.reembolsado"),
  pendiente_pago: t("transicion.pendiente_pago"),
  esperando_verificacion: t("transicion.esperando_verificacion"),
};

/**
 * Transiciones que borran plata o stock y merecen una confirmación extra.
 * No es seguridad — `transitionOrder` valida igual —, es no cancelar un
 * pedido con el pulgar en el celular.
 */
export const DESTRUCTIVE_TRANSITIONS: readonly OrderStatus[] = [
  "cancelado",
  "rechazado",
  "reembolsado",
  "vencido",
];
