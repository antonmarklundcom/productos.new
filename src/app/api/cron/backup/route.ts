import { safeError } from "@/lib/safe-error";
import { runBackup, backupsEnabled } from "@/domain/backup";
import { resolveDigestNotifier } from "@/domain/daily-digest";
import { claimJob, finishJob } from "@/domain/job-runs";
import { withTimeout } from "@/domain/notify-timing";
import { cronJson, requireCronSecret } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { cargarIntegraciones } from "@/lib/integraciones-store";

/**
 * El cron de la copia de seguridad (plan-operacion §5.4 A).
 *
 * Se llama desde el hPanel una vez por día de madrugada (DEPLOY.md §5):
 *
 *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://tienda.py/api/cron/backup
 *
 * **Nunca corre dos veces a la vez.** El lock de `job_runs` tiene expiración
 * (`claimJob('backup', { lockMinutes })`), porque un proceso que se muere no
 * libera nada y un lock eterno deja al comercio sin copias sin que nadie se
 * entere — que es exactamente el modo de falla que un backup no puede tener.
 *
 * **Si falla, el dueño se entera.** Un backup que falla en silencio es peor
 * que no tener backup: da la tranquilidad sin dar la copia. El aviso sale por
 * el mismo camino que el resumen diario (post-commit, con timeout, y **jamás**
 * hace fallar la ruta: si Meta está caído, el problema del backup ya quedó en
 * `job_runs.last_error` igual).
 */

export const dynamic = "force-dynamic";

/**
 * Media hora. Un dump de una tienda grande puede tardar minutos; más que esto
 * y la corrida está muerta, no lenta.
 */
const LOCK_MINUTES = 30;

/** Más que esto esperando a Meta y no vale la pena: el backup ya terminó. */
const AVISO_TIMEOUT_MS = 10_000;

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

async function handle(request: Request): Promise<Response> {
  const auth = requireCronSecret(request);
  if (!auth.ok) return auth.response;

  // Plantillas y credenciales pueden venir de /admin/integraciones.
  await cargarIntegraciones();

  // Sin Cloudinary no hay dónde guardar la copia. Se contesta 200 y no un
  // error: no es una falla de esta corrida, es una tienda que no configuró la
  // feature, y un status de error haría que Hostinger reintente para siempre.
  if (!backupsEnabled()) {
    return cronJson({ ok: true, skipped: "sin_cloudinary", uploaded: false });
  }

  const claim = await claimJob("backup", { lockMinutes: LOCK_MINUTES });
  if (!claim.claimed) {
    return cronJson({ ok: true, skipped: claim.reason, uploaded: false });
  }

  try {
    const resultado = await runBackup();

    log.info("backup listo", {
      tables: resultado.tables,
      rows: resultado.rows,
      bytes: resultado.bytes,
      pruned: resultado.pruned,
    });

    await finishJob("backup", { ok: true, payload: resultado });

    // Sin el `publicId`: el nombre del archivo es media pista para encontrarlo,
    // y esta respuesta la ve cualquiera con acceso a los logs del hPanel.
    return cronJson({
      ok: true,
      uploaded: true,
      tables: resultado.tables,
      rows: resultado.rows,
      bytes: resultado.bytes,
      pruned: resultado.pruned,
    });
  } catch (error) {
    const motivo = safeError(error).message;
    log.error("backup falló", { error: motivo });

    await finishJob("backup", { ok: false, error: motivo });
    void avisarDelFallo(motivo);

    return cronJson({ error: "backup_failed" }, 500);
  }
}

/**
 * Le avisa al dueño que el backup falló. **No tira nunca.**
 *
 * Reusa la plantilla del resumen diario: es "algo que el dueño tiene que saber
 * hoy", y pedirle a Meta una plantilla más para una línea de texto sería
 * agregarle un trámite a cada tienda por un aviso que ojalá nunca salga.
 */
async function avisarDelFallo(motivo: string): Promise<void> {
  try {
    const notifier = resolveDigestNotifier();
    if (!notifier) return;

    await withTimeout(
      notifier.sender.send({
        to: notifier.to,
        // Sin el detalle técnico: el dueño no puede hacer nada con un stack, y
        // este texto viaja por WhatsApp. El motivo completo está en
        // `job_runs.last_error` y en el log.
        body: "No se pudo hacer la copia de seguridad de hoy. Avisale a quien te maneja el sitio.",
        templateName: notifier.templateName,
      }),
      AVISO_TIMEOUT_MS
    );
  } catch (error) {
    log.warn("no se pudo avisar del backup fallido", {
      error: safeError(error).message,
      motivo,
    });
  }
}
