import { safeError } from "@/lib/safe-error";
import { sendDailyDigest } from "@/domain/daily-digest";
import { claimJob, finishJob } from "@/domain/job-runs";
import { sweepBackInStock } from "@/domain/stock-alerts";
import { cronJson, requireCronSecret } from "@/lib/cron-auth";
import { log, mensajeDe } from "@/lib/log";
import { cargarIntegraciones } from "@/lib/integraciones-store";
import { purgeLoginTokens } from "@/domain/login-tokens";
import { purgeOperationKeys } from "@/domain/operation-keys";

/**
 * El cron del resumen diario (plan-operacion §5.2 C).
 *
 * Se llama desde el cron job del hPanel de Hostinger, una vez por día
 * temprano (DEPLOY.md tiene la línea exacta y el offset de Asunción):
 *
 *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://tienda.py/api/cron/resumen-diario
 *
 * **Se puede llamar diez veces y manda una sola**: `claimJob('resumen_diario',
 * { onceEvery: 'dia' })` decide en una transacción con la fila bloqueada, con
 * el día calendario de Asunción. Eso no es paranoia — Hostinger reintenta, un
 * humano lo dispara a mano para probarlo, y dos entradas del hPanel apuntando
 * a la misma URL es el error más común de configuración que existe.
 *
 * Aprovecha el viaje para el **barrido** de "avisame cuando haya stock": la
 * disponibilidad que libera una reserva vencida no tiene ninguna escritura
 * detrás de la cual colgar el aviso, así que alguien tiene que pasar a mirar.
 * Va después del resumen y su resultado nunca decide el `ok` del trabajo: el
 * resumen es lo que el dueño espera a las ocho, y un barrido que falla no
 * puede impedir que salga mañana.
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
  const auth = requireCronSecret(request);
  if (!auth.ok) return auth.response;

  // Plantillas y credenciales pueden venir de /admin/integraciones.
  await cargarIntegraciones();

  const claim = await claimJob("resumen_diario", { onceEvery: "dia" });
  if (!claim.claimed) {
    // 200 y no 429: para Hostinger esto **no es un error**. Un status de
    // error lo haría reintentar, y el reintento tampoco mandaría nada.
    return cronJson({ ok: true, skipped: claim.reason, sent: false });
  }

  try {
    const resumen = await sendDailyDigest();
    await purgeLoginTokens();
    await purgeOperationKeys();
    const barrido = await sweepBackInStock();

    // Sólo cantidades: los logs de Hostinger los ve cualquiera con acceso al
    // hPanel, y acá adentro no van números de pedido ni teléfonos.
    log.info("cron: resumen diario", {
      sent: resumen.sent,
      comprobantes: resumen.digest.comprobantesPendientes,
      sinPagar: resumen.digest.sinPagar.length,
      stockBajo: resumen.digest.stockBajo.length,
      avisosStock: barrido.enviadas,
    });

    // Un sender caído deja `sent: false` y el motivo en `job_runs.last_error`,
    // pero la corrida **fue exitosa como corrida**: se armó el resumen, se
    // intentó, quedó anotado. Marcarla fallida haría que el cron de las 8:15
    // volviera a intentar y le llegara el resumen dos veces al dueño el día
    // que Meta se recupera solo.
    await finishJob("resumen_diario", {
      ok: true,
      error: resumen.error,
      payload: {
        sent: resumen.sent,
        comprobantes: resumen.digest.comprobantesPendientes,
        sinPagar: resumen.digest.sinPagar.length,
        stockBajo: resumen.digest.stockBajo.length,
        avisosStock: barrido.enviadas,
      },
    });

    return cronJson({
      ok: true,
      sent: resumen.sent,
      comprobantes: resumen.digest.comprobantesPendientes,
      sinPagar: resumen.digest.sinPagar.length,
      stockBajo: resumen.digest.stockBajo.length,
      avisosStock: barrido.enviadas,
    });
  } catch (error) {
    log.error("cron resumen: falló la corrida", { error: mensajeDe(error) });
    // Acá sí falla de verdad (la base se cayó a mitad): `last_ok_at` no se
    // mueve, así que la corrida siguiente del mismo día vuelve a intentar.
    await finishJob("resumen_diario", {
      ok: false,
      error: safeError(error).message,
    });
    return cronJson({ error: "internal_error" }, 500);
  }
}
