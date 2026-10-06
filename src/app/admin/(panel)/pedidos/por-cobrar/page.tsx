import type { Metadata } from "next";
import Link from "next/link";

import { OrderStatusBadge } from "@/components/admin/order-status-badge";
import { PAYMENT_METHOD_LABEL } from "@/lib/order-labels";
import { listOrdersToRecover, type RecoverableOrderRow } from "@/domain/admin-orders";
import { buyerWaLink, recoveryMessage } from "@/domain/order-messages";
import { getDatosBancarios, type DatosBancarios } from "@/lib/comercio";
import { formatGs } from "@/lib/money";
import { formatDateTimePY } from "@/lib/py";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { t, tPlural } from "@/i18n";

export const metadata: Metadata = { title: t("panel.porCobrar.meta") };

export const dynamic = "force-dynamic";

/**
 * Recuperación de pedidos sin pagar.
 *
 * Un `pendiente_pago` de hace tres días y un `vencido` son el mismo trabajo:
 * alguien tiene que escribirle. Están en la misma pantalla, ordenados por
 * antigüedad, y el botón de WhatsApp está en **la fila** y no un click más
 * adentro: el dueño hace esto parado en el local entre cliente y cliente, y
 * un click de más es la diferencia entre hacerlo y no hacerlo.
 *
 * El mensaje lleva la fricción resuelta —datos del banco, el total exacto y
 * el link tokenizado para subir el comprobante— y **nunca** el detalle de lo
 * comprado: eso aparece en una pantalla de bloqueo (ver `order-messages.ts`).
 *
 * Acá no hay ningún botón que toque la reserva de stock, y es a propósito
 * (ver `listOrdersToRecover`).
 */
export default async function PorCobrarPage() {
  await requireCapabilityPage("pedidos.cobrar");

  const [{ rows, total }, banco] = await Promise.all([
    listOrdersToRecover(),
    // Una sola vez para toda la pantalla y no una por fila: `recoveryMessage`
    // los recibe como parámetro desde el PR T (ver `order-messages.ts`).
    getDatosBancarios(),
  ]);

  const vencidos = rows.filter((row) => row.status === "vencido").length;

  return (
    <div>
      <Link href="/admin/pedidos" className="text-muted-foreground text-sm">
        {t("panel.porCobrar.volver")}
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{t("panel.porCobrar.titulo")}</h1>
        <p className="text-muted-foreground text-sm tabular-nums">
          {tPlural("panel.pedidos.cuenta", total)}
          {vencidos > 0 ? tPlural("panel.porCobrar.vencidos", vencidos) : ""}
        </p>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        {t("panel.porCobrar.bajada")}
      </p>

      {/* Un listado cortado que no dice que está cortado es peor que uno
          paginado: el dueño llega al final y cree que terminó. */}
      {rows.length < total ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {t("panel.porCobrar.cortado", { n: rows.length, total })}
        </p>
      ) : null}

      {!banco ? (
        <p className="border-border bg-muted/40 mt-4 rounded-lg border p-3 text-sm">
          {t("panel.porCobrar.sinBanco")}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-muted-foreground border-border mt-6 rounded-xl border border-dashed p-8 text-center text-sm">
          {t("panel.porCobrar.sinResultados")}
        </p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {rows.map((order) => (
            <li key={order.id} className="border-border rounded-xl border">
              <Link href={`/admin/pedidos/${order.id}`} className="hover:bg-muted/50 block p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium tabular-nums">{order.orderNumber}</span>
                  <OrderStatusBadge status={order.status} />
                </div>

                <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-sm">{order.customerName}</span>
                  <span className="font-semibold tabular-nums">{formatGs(order.totalPyg)}</span>
                </div>

                <p className="text-muted-foreground mt-1 text-xs">
                  {formatDateTimePY(order.createdAt)} · {PAYMENT_METHOD_LABEL[order.paymentMethod]} ·{" "}
                  <Antiguedad days={order.ageDays} />
                </p>
              </Link>

              <RecoveryLink order={order} banco={banco} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Días desde que se creó — el dato que ordena la prioridad de la llamada.
 * El número lo cuenta MySQL en la misma consulta: acá sólo se conjuga.
 */
function Antiguedad({ days }: { days: number }) {
  if (days <= 0) return <>{t("panel.porCobrar.hoy")}</>;
  return <>{tPlural("panel.porCobrar.antiguedad", days)}</>;
}

function RecoveryLink({
  order,
  banco,
}: {
  order: RecoverableOrderRow;
  banco: DatosBancarios | null;
}) {
  const href = buyerWaLink(order, recoveryMessage(order, banco));
  if (!href) return null;

  return (
    <div className="border-border border-t px-4 py-2">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        className="text-sm font-medium underline"
      >
        {t("panel.porCobrar.escribir")}
      </a>
    </div>
  );
}
