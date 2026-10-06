import { eq, sql } from 'drizzle-orm';

import { getDb } from '@/db';
import { jobRuns } from '@/db/schema';
import { startOfDayPY } from '@/lib/py';

import type { Executor, Tx } from './executor';

/**
 * Idempotencia y lock de los trabajos programados (plan-operacion §0.5, §5.2 B).
 *
 * **Un cron es una función que puede correr dos veces seguidas.** No es una
 * hipótesis: Hostinger reintenta, un humano lo dispara a mano para probarlo, y
 * dos entradas del hPanel pueden estar apuntando a la misma URL desde que
 * alguien duplicó la línea hace seis meses. Sin esto, el resumen diario le
 * llega tres veces al dueño —y a la cuarta lo silencia— y dos backups se pisan
 * escribiendo el mismo archivo.
 *
 * Dos formas de "no ahora", una por cada trabajo del plan:
 *
 *  - **`onceEvery: 'dia'`** (`resumen_diario`): ya corrió bien hoy, en el día
 *    calendario de **Asunción**. Se mira el último **éxito** (`last_ok_at`) y
 *    no el último intento: un intento fallido a las 8:00 tiene que poder
 *    reintentarse a las 9:00, que es justamente para lo que sirve que el cron
 *    pegue cada quince minutos.
 *  - **`lockMinutes`** (`backup`): hay una corrida viva —`started_at` sin
 *    `finished_at`— de hace menos de N minutos. Con expiración, y eso es lo
 *    importante: un proceso que muere no llama a `finishJob`, así que un lock
 *    sin vencimiento deja el trabajo apagado para siempre y nadie se entera
 *    hasta que hace falta el backup.
 *
 * Todo se decide en **una** transacción con la fila bloqueada. Dos requests
 * simultáneos entran los dos a la puerta: el segundo espera el lock del
 * primero y recién entonces lee `last_ok_at`, que para ese momento ya dice que
 * alguien corrió. Con un `SELECT` fuera de transacción, los dos leerían "no
 * corrió" y los dos mandarían.
 */

export type JobName = 'resumen_diario' | 'backup' | 'vencer_pedidos';

export type ClaimOptions = {
  /**
   * `'dia'`: una corrida exitosa por día calendario de Asunción.
   * `null` (default): no hay límite por día, sólo el lock.
   */
  onceEvery?: 'dia' | null;
  /**
   * Cuántos minutos vale el lock de una corrida viva. Pasado ese tiempo se
   * considera muerta y otra corrida puede tomarlo.
   */
  lockMinutes?: number;
  /** Para testear el borde del día sin esperar a mañana. */
  now?: Date;
  executor?: Executor;
};

export type ClaimResult =
  | { claimed: true }
  | { claimed: false; reason: 'ya_corrio_hoy' | 'en_curso' };

/** El default: media hora es más que cualquier corrida sana de estos dos jobs. */
export const DEFAULT_LOCK_MINUTES = 30;

/**
 * ¿Esta corrida corre? Si devuelve `claimed: true`, la fila ya quedó marcada
 * como "en curso" y **hay que llamar a `finishJob`**, salga bien o mal.
 */
export async function claimJob(job: JobName, options: ClaimOptions = {}): Promise<ClaimResult> {
  const now = options.now ?? new Date();
  const lockMinutes = options.lockMinutes ?? DEFAULT_LOCK_MINUTES;
  const lockExpiredBefore = new Date(now.getTime() - lockMinutes * 60_000);

  const run = async (tx: Tx | Executor): Promise<ClaimResult> => {
    // `INSERT … ON DUPLICATE KEY UPDATE job = job` es un no-op que garantiza
    // que la fila exista para poder bloquearla. Sin esto, el primerísimo cron
    // de una tienda nueva no tendría nada que lockear y dos corridas
    // simultáneas insertarían las dos.
    //
    // La fila nace **terminada** (`finished_at = started_at`) y no en curso:
    // representa "nunca corrió", no "hay una corrida viva". Con `finished_at`
    // en NULL, la primerísima llamada se encontraría a sí misma y se
    // contestaría `en_curso` — el trabajo no correría nunca hasta que
    // venciera el lock.
    await tx.execute(
      sql`INSERT INTO \`job_runs\` (\`job\`, \`started_at\`, \`finished_at\`)
          VALUES (${job}, ${now}, ${now})
          ON DUPLICATE KEY UPDATE \`job\` = \`job\``,
    );

    const locked = await tx
      .select({
        startedAt: jobRuns.startedAt,
        finishedAt: jobRuns.finishedAt,
        lastOkAt: jobRuns.lastOkAt,
      })
      .from(jobRuns)
      .where(eq(jobRuns.job, job))
      .for('update');

    // Siempre hay fila: el INSERT de arriba se encargó. El `if` es para el
    // tipo, no para un caso real.
    const row = locked[0];
    if (row) {
      // Lock: hay una corrida empezada, sin terminar, y todavía fresca.
      const enCurso =
        row.finishedAt === null && row.startedAt !== null && row.startedAt > lockExpiredBefore;
      if (enCurso) return { claimed: false, reason: 'en_curso' };

      if (options.onceEvery === 'dia' && row.lastOkAt !== null) {
        // El día calendario **de Asunción**, no el UTC: a las 21:00 de
        // Asunción ya es el día siguiente en UTC, y con la comparación en UTC
        // el resumen de la mañana saldría dos veces cada noche.
        if (row.lastOkAt >= startOfDayPY(now)) {
          return { claimed: false, reason: 'ya_corrio_hoy' };
        }
      }
    }

    await tx
      .update(jobRuns)
      .set({ startedAt: now, finishedAt: null, lastError: null })
      .where(eq(jobRuns.job, job));

    return { claimed: true };
  };

  // Con `executor` (un test que ya abrió su transacción) se corre adentro de
  // la de quien llama; si no, la nuestra. El `FOR UPDATE` sólo significa algo
  // adentro de una transacción, así que esto no es opcional.
  return options.executor ? run(options.executor) : getDb().transaction(run);
}

export type FinishOptions = {
  ok: boolean;
  /** Motivo del fallo, recortado a la columna. Se ignora si `ok`. */
  error?: string | null;
  /** Lo que produjo la corrida: cantidades, nunca datos de compradoras. */
  payload?: unknown;
  now?: Date;
  executor?: Executor;
};

/**
 * Cierra la corrida. **Siempre** se llama, salga bien o mal: si no, el lock
 * queda tomado hasta que expire y el trabajo pierde una ventana entera.
 *
 * `last_ok_at` sólo se mueve con `ok: true`, que es lo que hace que un fallo
 * pueda reintentarse en la corrida siguiente del mismo día.
 */
export async function finishJob(job: JobName, options: FinishOptions): Promise<void> {
  const now = options.now ?? new Date();
  const tx = options.executor ?? getDb();

  await tx
    .update(jobRuns)
    .set({
      finishedAt: now,
      ...(options.ok ? { lastOkAt: now, lastError: null } : {}),
      ...(options.ok ? {} : { lastError: recortarError(options.error) }),
      payload: (options.payload ?? null) as never,
    })
    .where(eq(jobRuns.job, job));
}

/**
 * Deja constancia de una corrida que no necesita lock ni "una vez por día"
 * (`vencer_pedidos`: cada paso ya bloquea su propia fila). Crea la fila si es
 * la primera y la cierra como `finishJob`.
 *
 * Existe para poder contestar "¿el cron está andando?": sin él, los pedidos
 * sin pagar no vencen, el stock queda reservado y no sale ningún recordatorio
 * de pago — y nada se rompe a la vista.
 */
export async function recordJobRun(job: JobName, options: FinishOptions): Promise<void> {
  const now = options.now ?? new Date();
  const tx = options.executor ?? getDb();
  await tx.execute(
    sql`INSERT INTO \`job_runs\` (\`job\`, \`started_at\`, \`finished_at\`)
        VALUES (${job}, ${now}, ${now})
        ON DUPLICATE KEY UPDATE \`started_at\` = VALUES(\`started_at\`)`,
  );
  await finishJob(job, { ...options, now, executor: tx });
}

/**
 * ¿El cron de vencimientos dejó de correr? `true` si nunca corrió bien o si
 * su último éxito es más viejo que `maxMinutes` (corre cada 15 min: dos horas
 * sin él son varias corridas perdidas, no un atraso).
 */
export function cronAtrasado(
  run: { lastOkAt: Date | null } | null,
  now: Date = new Date(),
  maxMinutes = 120,
): boolean {
  if (!run?.lastOkAt) return true;
  return now.getTime() - run.lastOkAt.getTime() > maxMinutes * 60_000;
}

/** El estado de un trabajo, para el panel y para los tests. */
export async function getJobRun(job: JobName, executor?: Executor) {
  const tx = executor ?? getDb();
  const rows = await tx.select().from(jobRuns).where(eq(jobRuns.job, job)).limit(1);
  return rows[0] ?? null;
}

/** Sin stack y sin saltos de línea: esto va a una `varchar(500)` y a un log. */
function recortarError(error: string | null | undefined): string | null {
  if (!error) return null;
  return error.replace(/\s+/g, ' ').trim().slice(0, 500) || null;
}
