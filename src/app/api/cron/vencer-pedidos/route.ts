import { dispatchOrderNotices } from "@/domain/notification-outbox";
import { recordJobRun } from "@/domain/job-runs";
import { runMaintenance } from "@/domain/maintenance";
import { cronJson, requireCronSecret } from "@/lib/cron-auth";
import { log, mensajeDe } from "@/lib/log";
import { cargarIntegraciones } from "@/lib/integraciones-store";

/**
 * Cron de Hostinger (PLAN.md 4.8).
 *
 * Se llama desde el cron job del panel de Hostinger, una vez cada 15 minutos:
 *
 *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://tienda.py/api/cron/vencer-pedidos
 *
 * Vence los pedidos sin pago que pasaron su `reserved_until` y limpia las
 * reservas viejas. Todo el trabajo pasa por `transitionOrder`, así que cada
 * vencimiento deja su fila en `order_events` con actor `cron`.
 *
 * Desde O15 la misma corrida manda los **recordatorios de pago** de los
 * pedidos a los que les quedan menos de 6 h de reserva — después de vencer, no
 * antes. No hay entrada nueva de cron en el hPanel: es ésta.
 */

// La ruta lee y escribe la DB en cada llamada: nunca se prerenderiza.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

/** Algunos cron runners sólo saben hacer POST. */
export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

async function handle(request: Request): Promise<Response> {
  // Secreto, rate limit y comparación en tiempo constante: `src/lib/cron-auth.ts`
  // (O6 la extrajo de acá para que las tres rutas de cron y `/api/version`
  // compartan exactamente la misma puerta). El comportamiento no cambió.
  const auth = requireCronSecret(request);
  if (!auth.ok) return auth.response;

  // Plantillas y credenciales pueden venir de /admin/integraciones.
  await cargarIntegraciones();

  try {
    const report = await runMaintenance();
    await dispatchOrderNotices();
    // Sólo cantidades. Los ids de pedido son datos del negocio y los logs de
    // Hostinger los ve cualquiera con acceso al hPanel.
    log.info("cron: vencimiento de pedidos", {
      vencidos: report.expired.length,
      salteados: report.skipped,
      reservasBorradas: report.reservationsDeleted,
      avisosStockPurgados: report.stockAlertsPurged,
      recordatorios: report.paymentReminders.enviados,
      recordatoriosFallidos: report.paymentReminders.fallidos,
    });

    // El latido que mira el resumen del panel: si falta, el cron del hPanel
    // no está configurado (o dejó de andar) y nadie más se entera.
    await recordJobRun("vencer_pedidos", {
      ok: true,
      payload: {
        vencidos: report.expired.length,
        recordatorios: report.paymentReminders.enviados,
      },
    });

    return cronJson({
      ok: true,
      expired: report.expired.length,
      skipped: report.skipped,
      reservationsDeleted: report.reservationsDeleted,
      paymentReminders: report.paymentReminders,
    });
  } catch (error) {
    log.error("cron: falló la corrida", { error: mensajeDe(error) });
    // Si la base está caída esto también falla: el aviso del panel igual
    // salta, porque mira el último éxito.
    await recordJobRun("vencer_pedidos", {
      ok: false,
      error: mensajeDe(error),
    }).catch(() => {});
    return cronJson({ error: "internal_error" }, 500);
  }
}
