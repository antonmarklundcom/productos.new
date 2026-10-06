import type { Metadata } from "next";
import Link from "next/link";

import { listRecentReturns } from "@/domain/returns";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { formatDateTimePY } from "@/lib/py";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("panel.devoluciones.meta") };

export const dynamic = "force-dynamic";

/**
 * `/admin/devoluciones` — las últimas 100 mercaderías que volvieron, con link
 * al pedido. Owner y staff (capability `devoluciones`).
 *
 * Es de lectura: una devolución se registra desde la ficha del pedido, que
 * es donde están las líneas y lo que queda por devolver de cada una.
 */
export default async function AdminReturnsPage() {
  await requireCapabilityPage("devoluciones");
  const devoluciones = await listRecentReturns(100);

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{t("panel.devoluciones.titulo")}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{t("panel.devoluciones.bajada")}</p>

      {devoluciones.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-sm">{t("panel.devoluciones.vacio")}</p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {devoluciones.map((devolucion) => (
            <li key={devolucion.id} className="border-border rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/admin/pedidos/${devolucion.orderId}`}
                  className="font-medium tabular-nums underline"
                >
                  {devolucion.orderNumber}
                </Link>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatDateTimePY(devolucion.createdAt)} · {devolucion.actorName ?? devolucion.actor}
                </span>
              </div>
              <ul className="mt-1">
                {devolucion.items.map((item, index) => (
                  <li key={index}>
                    {t("panel.devoluciones.item", { n: item.qty, producto: item.name })}{" "}
                    <span className="text-muted-foreground text-xs">
                      ·{" "}
                      {item.restocked
                        ? t("panel.devoluciones.repuesto")
                        : t("panel.devoluciones.noRepuesto")}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-1 text-xs whitespace-pre-line">
                {t("panel.devoluciones.motivo", { motivo: devolucion.reason })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
