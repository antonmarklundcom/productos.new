import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@/db/schema";

import { ORDER_STATUS_LABEL } from "@/lib/order-labels";

/**
 * El color codifica "¿tengo que hacer algo?", no la etapa del pedido:
 * `esperando_verificacion` es lo único que espera al dueño, así que es lo
 * único que resalta.
 */
const VARIANT: Record<OrderStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pendiente_pago: "outline",
  esperando_verificacion: "default",
  pagado: "secondary",
  preparando: "secondary",
  enviado: "secondary",
  entregado: "outline",
  rechazado: "destructive",
  vencido: "outline",
  cancelado: "outline",
  reembolsado: "destructive",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={VARIANT[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}
