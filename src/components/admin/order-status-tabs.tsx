import Link from "next/link";

import { ORDER_STATUSES, type OrderStatus } from "@/db/enums";
import type { OrderStatusCounts } from "@/domain/admin-orders";

import { ORDER_STATUS_LABEL } from "@/lib/order-labels";
import { t } from "@/i18n";

/**
 * Accesos rápidos por estado, arriba del listado de pedidos.
 *
 * El orden es el del trabajo del día y no el del ENUM: primero lo que espera
 * al dueño (verificar un comprobante, esperar un pago), después lo que espera
 * a la compradora, y al final lo que ya terminó o se cayó.
 */
const TAB_ORDER: readonly OrderStatus[] = [
  "esperando_verificacion",
  "pendiente_pago",
  "pagado",
  "preparando",
  "enviado",
  "entregado",
  "rechazado",
  "vencido",
  "cancelado",
  "reembolsado",
];

// Si mañana alguien agrega un estado al ENUM y se olvida de esta lista, el
// acceso rápido no existiría y nadie se enteraría. Los que falten van al final.
const TABS: readonly OrderStatus[] = [
  ...TAB_ORDER,
  ...ORDER_STATUSES.filter((status) => !TAB_ORDER.includes(status)),
];

/**
 * Estados que siempre se muestran, tengan o no pedidos: son la pregunta que el
 * dueño viene a hacerle al panel ("¿algo esperando por mí?"). Un cero también
 * es una respuesta. El resto aparece sólo cuando hay algo adentro, para no
 * llenar la pantalla del celular de accesos que no llevan a ningún lado.
 */
const ALWAYS_VISIBLE: readonly OrderStatus[] = [
  "esperando_verificacion",
  "pendiente_pago",
  "pagado",
  "enviado",
];

export function OrderStatusTabs({
  counts,
  active,
  query,
}: {
  counts: OrderStatusCounts;
  active: OrderStatus | undefined;
  /** El resto de los filtros vigentes: cambiar de estado no los pierde. */
  query: Record<string, string | undefined>;
}) {
  const href = (status: OrderStatus | undefined): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }
    if (status) params.set("estado", status);
    // Cambiar de estado vuelve a la página 1: la 4 de un listado que ahora
    // tiene una es una pantalla vacía sin explicación.
    params.delete("pagina");
    const qs = params.toString();
    return qs === "" ? "/admin/pedidos" : `/admin/pedidos?${qs}`;
  };

  const visible = TABS.filter(
    (status) =>
      counts.byStatus[status] > 0 || ALWAYS_VISIBLE.includes(status) || status === active,
  );

  return (
    <nav aria-label={t("panel.filtros.porEstado")} className="-mx-4 mt-4 overflow-x-auto px-4">
      <ul className="flex w-max gap-2">
        <li>
          <Chip href={href(undefined)} active={active === undefined} count={counts.total}>
            {t("panel.filtros.todos")}
          </Chip>
        </li>
        {visible.map((status) => (
          <li key={status}>
            <Chip
              href={href(status)}
              active={active === status}
              count={counts.byStatus[status]}
            >
              {ORDER_STATUS_LABEL[status]}
            </Chip>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Chip({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "bg-primary text-primary-foreground flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
          : "border-border hover:bg-muted flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm"
      }
    >
      {children}
      <span className="tabular-nums opacity-70">{count}</span>
    </Link>
  );
}
