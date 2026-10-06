import type { Metadata } from "next";
import Link from "next/link";

import { UnmatchedPayments } from "@/components/admin/unmatched-payments";
import { listOrders } from "@/domain/admin-orders";
import { getDashboardSummary, salesTrend, topProducts } from "@/domain/admin-dashboard";
import { DEFAULT_REORDER_POINT, lowStockVariants } from "@/domain/admin-products";
import { getStoreSettings } from "@/domain/store-settings";
import { umbralStockBajo } from "@/domain/store-settings-schema";
import { cronAtrasado, getJobRun } from "@/domain/job-runs";
import { countActiveDemoProducts, countActiveShippingZones } from "@/domain/launch-checks";
import { findUnmatchedPayments } from "@/domain/payment-recovery";
import { getDatosBancarios } from "@/lib/comercio";
import { formatGs } from "@/lib/money";
import { formatDatePY, formatDateTimePY } from "@/lib/py";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { can } from "@/lib/permissions";
import { t, tPlural } from "@/i18n";

export const metadata: Metadata = { title: t("panel.resumen.meta") };

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const actor = await requireCapabilityPage("dashboard");
  // El umbral global de stock bajo sale de `/admin/ajustes`; el de cada
  // variante igual gana.
  const { stock } = await getStoreSettings();

  const [summary, awaiting, lowStock, unmatched, top, trend, banco, demo, zonas, cron] =
    await Promise.all([
    getDashboardSummary(),
    listOrders({ status: "esperando_verificacion", perPage: 5 }),
    lowStockVariants(umbralStockBajo(stock, DEFAULT_REORDER_POINT), 8),
    findUnmatchedPayments({ limit: 10 }),
    topProducts(),
    salesTrend(),
    getDatosBancarios(),
    countActiveDemoProducts(),
    countActiveShippingZones(),
    getJobRun("vencer_pedidos"),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{t("panel.resumen.titulo")}</h1>

      {/*
        Sin datos bancarios en ninguna de las dos fuentes (tabla ni entorno),
        la página del pedido le dice a la compradora que faltan — ese aviso ya
        existía. Lo que faltaba era el del otro lado: el dueño no mira la
        página de un pedido ajeno, así que nunca se enteraba. `pnpm preflight`
        tampoco alcanza: es env-only y no ve la tabla.
      */}
      {banco === null && can(actor.role, "banco") ? (
        <section className="border-border bg-muted/40 mt-4 rounded-xl border p-4">
          <h2 className="font-medium">{t("panel.resumen.sinBanco")}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("panel.resumen.sinBanco.ayuda")}
          </p>
          <Link href="/admin/banco" className="mt-2 inline-block text-sm font-medium underline">
            {t("panel.resumen.sinBanco.link")}
          </Link>
        </section>
      ) : null}

      {/*
        El catálogo de ejemplo del setup, todavía a la venta al lado del real
        (src/domain/launch-checks.ts). Nadie lo ve desde el panel si no se lo
        dice: la dueña carga lo suyo y los auriculares de ejemplo siguen ahí.
      */}
      {demo > 0 && can(actor.role, "productos") ? (
        <section className="border-border bg-muted/40 mt-4 rounded-xl border p-4">
          <h2 className="font-medium">{t("panel.resumen.demo", { n: demo })}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("panel.resumen.demo.ayuda")}</p>
          <Link href="/admin/productos" className="mt-2 inline-block text-sm font-medium underline">
            {t("panel.resumen.demo.link")}
          </Link>
        </section>
      ) : null}

      {zonas === 0 && can(actor.role, "envios") ? (
        <section className="border-border bg-muted/40 mt-4 rounded-xl border p-4">
          <h2 className="font-medium">{t("panel.resumen.sinZonas")}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("panel.resumen.sinZonas.ayuda")}</p>
          <Link href="/admin/envios" className="mt-2 inline-block text-sm font-medium underline">
            {t("panel.resumen.sinZonas.link")}
          </Link>
        </section>
      ) : null}

      {/*
        El cron de vencimientos (DEPLOY.md §5) no se ve fallar: sin él, los
        pedidos sin pagar no vencen, el stock queda reservado y no sale ningún
        recordatorio de pago. Sólo al dueño: es quien tiene el hPanel.
      */}
      {cronAtrasado(cron) && can(actor.role, "usuarios") ? (
        <section className="border-border bg-muted/40 mt-4 rounded-xl border p-4">
          <h2 className="font-medium">
            {cron?.lastOkAt
              ? t("panel.resumen.cronParado", { cuando: formatDateTimePY(cron.lastOkAt) })
              : t("panel.resumen.cronNunca")}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("panel.resumen.cron.ayuda")}</p>
        </section>
      ) : null}

      {/*
        Va arriba de todo y sólo aparece si hay algo: es plata de un comprador
        que está en la cuenta del comercio sin un pedido vivo detrás
        (ARCH.md §4.1). Cada fila es una devolución pendiente.
      */}
      {unmatched.length > 0 && (
        <section className="border-destructive/40 bg-destructive/5 mt-4 rounded-xl border p-4">
          <h2 className="text-destructive font-medium">{t("panel.resumen.sinPedidoVivo")}</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {t("panel.resumen.sinPedidoVivo.ayuda")}
          </p>
          <UnmatchedPayments
            payments={unmatched.map((payment) => ({
              paymentId: payment.paymentId,
              orderId: payment.orderId,
              orderNumber: payment.orderNumber,
              orderStatus: payment.orderStatus,
              provider: payment.provider,
              amountPyg: payment.amountPyg,
              paidAt: formatDateTimePY(payment.paidAt),
              // == S17 == `findUnmatchedPayments` (O14) ya trae el real.
              refundedPyg: payment.refundedPyg,
            }))}
            puedeDevolver={can(actor.role, "reembolsos")}
          />
        </section>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Stat
          label={t("panel.resumen.ventasHoy")}
          value={formatGs(summary.today.totalPyg)}
          hint={tPlural("panel.resumen.cobrados", summary.today.orders)}
        />
        <Stat
          label={t("panel.resumen.ventasMes")}
          value={formatGs(summary.month.totalPyg)}
          hint={tPlural("panel.resumen.cobrados", summary.month.orders)}
        />
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {t("panel.resumen.soloCobrados")}
      </p>

      <section className="mt-8">
        <h2 className="font-medium">{t("panel.resumen.ultimos7")}</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          {t("panel.resumen.ultimos7.ayuda")}
        </p>
        <SalesTrend days={trend} />
      </section>

      <section className="mt-8">
        <h2 className="font-medium">{t("panel.resumen.masVendido")}</h2>
        {top.length === 0 ? (
          <p className="text-muted-foreground border-border mt-2 rounded-xl border border-dashed p-6 text-center text-sm">
            {t("panel.resumen.sinVentas")}
          </p>
        ) : (
          <ol className="divide-border mt-2 divide-y text-sm">
            {top.map((product, index) => (
              <li key={product.productId} className="flex items-baseline gap-3 py-2">
                <span className="text-muted-foreground w-4 shrink-0 tabular-nums">{index + 1}</span>
                <Link
                  href={`/admin/productos/${product.productId}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {product.name}
                </Link>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {t("panel.resumen.unidades", { n: product.qty })}
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatGs(product.totalPyg)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-medium">{t("panel.resumen.esperandoVerificacion")}</h2>
          <Link href="/admin/pedidos?estado=esperando_verificacion" className="text-sm underline">
            {t("panel.resumen.verTodos", { n: summary.awaitingVerification })}
          </Link>
        </div>

        {awaiting.rows.length === 0 ? (
          <p className="text-muted-foreground border-border mt-2 rounded-xl border border-dashed p-6 text-center text-sm">
            {t("panel.resumen.sinComprobantes")}
          </p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {awaiting.rows.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/admin/pedidos/${order.id}`}
                  className="border-border hover:bg-muted/50 block rounded-xl border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium tabular-nums">{order.orderNumber}</span>
                    <span className="font-semibold tabular-nums">{formatGs(order.totalPyg)}</span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {order.customerName} · {formatDateTimePY(order.createdAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-medium">{t("panel.resumen.stockBajo")}</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          {t("panel.resumen.stockBajo.ayuda")}
        </p>
        {lowStock.length === 0 ? (
          <p className="text-muted-foreground border-border mt-2 rounded-xl border border-dashed p-6 text-center text-sm">
            {t("panel.resumen.sinStockBajo")}
          </p>
        ) : (
          <ul className="divide-border mt-2 divide-y text-sm">
            {lowStock.map((variant) => (
              <li key={variant.variantId} className="flex justify-between gap-3 py-2">
                <span>
                  {variant.productName}
                  <span className="text-muted-foreground"> · {variant.label}</span>
                  <span className="text-muted-foreground block text-xs">{variant.sku}</span>
                </span>
                <span
                  className={`shrink-0 font-medium tabular-nums ${variant.available === 0 ? "text-destructive" : ""}`}
                >
                  {variant.available}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-medium">{t("panel.resumen.pendientes")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {tPlural("panel.resumen.pendientes", summary.pendingPayment)}
        </p>
        <Link
          href="/admin/pedidos?estado=pendiente_pago"
          className="mt-2 inline-block text-sm underline"
        >
          {t("panel.resumen.verPendientes")}
        </Link>
      </section>
    </div>
  );
}

/**
 * Tendencia de la semana.
 *
 * Barras de CSS y no una librería de gráficos: son siete números, y meter un
 * paquete de charting al bundle por esto es cargar 50 kB para dibujar siete
 * rectángulos. Los montos están escritos al lado de cada barra, así que la
 * barra es una ayuda visual y no el único portador del dato — que además es lo
 * que lo hace legible en un lector de pantalla.
 */
function SalesTrend({ days }: { days: Array<{ day: Date; totalPyg: number; orders: number }> }) {
  const max = Math.max(...days.map((day) => day.totalPyg), 1);

  return (
    <ul className="divide-border mt-2 divide-y text-sm">
      {days.map((day) => (
        <li key={day.day.toISOString()} className="flex items-center gap-3 py-2">
          <span className="text-muted-foreground w-20 shrink-0 text-xs tabular-nums">
            {formatDatePY(day.day)}
          </span>
          <span className="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full">
            <span
              className="bg-primary block h-full rounded-full"
              // El ancho es el único dato que no puede vivir en una clase de
              // Tailwind: sale de una consulta, no de la hoja de estilos.
              style={{ width: `${Math.round((day.totalPyg / max) * 100)}%` }}
            />
          </span>
          <span className="shrink-0 tabular-nums">{formatGs(day.totalPyg)}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="border-border rounded-xl border p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
    </div>
  );
}
