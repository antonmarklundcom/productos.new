import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/admin/print-button";
import { getAdminOrder } from "@/domain/admin-orders";
import { adminActor } from "@/lib/admin-guard";
import { formatGs } from "@/lib/money";
import { can } from "@/lib/permissions";
import { formatDateTimePY, formatPhonePY } from "@/lib/py";
import { PAYMENT_METHOD_LABEL } from "@/lib/order-labels";
import { t } from "@/i18n";
import { nombreTienda } from "@/lib/marca";

export const metadata: Metadata = { title: t("panel.remito.meta") };

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

/**
 * El remito imprimible (plan-operacion §6.1).
 *
 * Vive bajo `/admin/(panel)`: el layout del panel ya exige sesión
 * (`requireAdmin` en `layout.tsx`), así que no hace falta repetir el guard
 * acá — sólo leer el rol para decidir si se ven los precios. El nav del
 * panel se oculta en el papel con el CSS de `@media print` de
 * `globals.css` (`header { display: none }`), no con un layout aparte: así
 * el guard sigue siendo uno solo.
 *
 * Sin precios para `vendedor` (ARCH.md §1: arma el paquete, no audita la
 * caja) — la misma regla que la ficha del pedido.
 */
export default async function OrderPrintPage({ params }: { params: Params }) {
  const actor = await adminActor();
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) notFound();

  const found = await getAdminOrder(orderId);
  if (!found) notFound();

  const { order, items } = found;
  const verPrecios = can(actor.role, "precios");

  return (
    <div className="s9-print-page mx-auto max-w-2xl text-sm">
      <div className="s9-no-print mb-4 flex items-center justify-between gap-3">
        <Link href={`/admin/pedidos/${order.id}`} className="text-muted-foreground text-sm">
          {t("panel.remito.volver")}
        </Link>
        <PrintButton />
      </div>

      <header className="flex items-start justify-between gap-4 border-b border-black pb-3">
        <div>
          <p className="text-lg font-semibold">{await nombreTienda()}</p>
          <p className="text-xs">{t("panel.remito.titulo")}</p>
        </div>
        <div className="text-right text-xs">
          <p>{formatDateTimePY(order.createdAt)}</p>
          <p>{PAYMENT_METHOD_LABEL[order.paymentMethod]}</p>
          {order.shippingMethodName ? <p>{order.shippingMethodName}</p> : null}
        </div>
      </header>

      {/* El cuadrado grande para pegar en el paquete: lo primero que se busca
          con las manos ocupadas armando la caja. */}
      <div className="my-4 border-2 border-black p-4 text-center">
        <p className="text-xs">{t("panel.remito.numeroPedido")}</p>
        <p className="text-3xl font-bold tracking-wide tabular-nums">{order.orderNumber}</p>
      </div>

      <section className="mt-4">
        <h2 className="font-medium">{t("panel.remito.entrega")}</h2>
        <dl className="mt-1 grid gap-0.5">
          <div className="flex justify-between gap-4">
            <dt>{t("panel.remito.nombre")}</dt>
            <dd className="text-right">{order.customerName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>{t("panel.remito.telefono")}</dt>
            <dd className="text-right tabular-nums">{formatPhonePY(order.customerPhone)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>{t("panel.remito.direccion")}</dt>
            <dd className="max-w-[70%] text-right">
              {order.shipAddress}
              {order.shipBarrio ? `, ${order.shipBarrio}` : ""}, {order.shipCity}
            </dd>
          </div>
          {order.shipReference ? (
            <div className="flex justify-between gap-4">
              <dt>{t("panel.remito.referencia")}</dt>
              <dd className="max-w-[70%] text-right">{order.shipReference}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {order.isGift ? (
        <section className="mt-4 border border-black p-2">
          <h2 className="font-medium">{t("panel.remito.esRegalo")}</h2>
          {order.giftNote ? (
            <p className="mt-1 whitespace-pre-line">“{order.giftNote}”</p>
          ) : null}
        </section>
      ) : null}

      <section className="mt-4">
        <h2 className="font-medium">{t("panel.remito.items")}</h2>
        <table className="mt-1 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-black">
              <th className="py-1 pr-2 font-medium">{t("panel.remito.sku")}</th>
              <th className="py-1 pr-2 font-medium">{t("panel.remito.producto")}</th>
              <th className="py-1 pr-2 text-right font-medium">{t("panel.remito.cantidad")}</th>
              {verPrecios ? (
                <th className="py-1 text-right font-medium">{t("panel.remito.total")}</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-black/30">
                <td className="py-1 pr-2 align-top tabular-nums">{item.skuSnapshot}</td>
                <td className="py-1 pr-2 align-top">{item.nameSnapshot}</td>
                <td className="py-1 pr-2 text-right align-top tabular-nums">{item.qty}</td>
                {verPrecios ? (
                  <td className="py-1 text-right align-top tabular-nums">
                    {formatGs(item.lineTotalPyg)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>

        {verPrecios ? (
          <p className="mt-2 text-right font-semibold tabular-nums">
            {t("panel.remito.totalPedido", { total: formatGs(order.totalPyg) })}
          </p>
        ) : null}
      </section>
    </div>
  );
}
