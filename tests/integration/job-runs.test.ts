import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { jobRuns } from '@/db/schema';
import { claimJob, cronAtrasado, finishJob, getJobRun, recordJobRun } from '@/domain/job-runs';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';

/**
 * Idempotencia y lock de los crons (O6, plan-operacion §5.2 B).
 *
 * El modo de falla que esto evita no es hipotético: Hostinger reintenta, un
 * humano dispara la URL a mano para probarla, y dos entradas del hPanel
 * apuntando a la misma ruta es el error de configuración más común que hay.
 * Sin `claimJob`, el resumen le llega tres veces al dueño y a la cuarta lo
 * silencia.
 */

/** Un instante conocido, para poder cruzar el borde del día sin esperar. */
const MEDIODIA_PY = new Date('2026-08-12T16:00:00Z'); // 13:00 en Asunción (UTC-3)

describe.skipIf(!hasTestDb)('claimJob — una vez por día', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('la primera corrida del día lo toma', async () => {
    const resultado = await claimJob('resumen_diario', { onceEvery: 'dia', now: MEDIODIA_PY });
    expect(resultado).toEqual({ claimed: true });
  });

  it('la segunda del mismo día no, si la primera terminó bien', async () => {
    await claimJob('resumen_diario', { onceEvery: 'dia', now: MEDIODIA_PY });
    await finishJob('resumen_diario', { ok: true, now: MEDIODIA_PY });

    const segunda = await claimJob('resumen_diario', {
      onceEvery: 'dia',
      now: new Date(MEDIODIA_PY.getTime() + 15 * 60_000),
    });
    expect(segunda).toEqual({ claimed: false, reason: 'ya_corrio_hoy' });
  });

  it('si la primera falló, la siguiente reintenta el mismo día', async () => {
    // Ésta es la razón por la que se mira `last_ok_at` y no `finished_at`: un
    // intento fallido a las 8:00 tiene que poder reintentarse a las 8:15, que
    // es para lo que sirve que el cron pegue seguido.
    await claimJob('resumen_diario', { onceEvery: 'dia', now: MEDIODIA_PY });
    await finishJob('resumen_diario', { ok: false, error: 'Meta 500', now: MEDIODIA_PY });

    const segunda = await claimJob('resumen_diario', {
      onceEvery: 'dia',
      now: new Date(MEDIODIA_PY.getTime() + 15 * 60_000),
    });
    expect(segunda).toEqual({ claimed: true });
  });

  it('al día siguiente vuelve a correr', async () => {
    await claimJob('resumen_diario', { onceEvery: 'dia', now: MEDIODIA_PY });
    await finishJob('resumen_diario', { ok: true, now: MEDIODIA_PY });

    const manana = await claimJob('resumen_diario', {
      onceEvery: 'dia',
      now: new Date(MEDIODIA_PY.getTime() + 24 * 3600_000),
    });
    expect(manana).toEqual({ claimed: true });
  });

  it('el día es el de Asunción, no el UTC', async () => {
    // A las 21:00 de Asunción ya es el día siguiente en UTC. Con la
    // comparación hecha en UTC, el resumen de la mañana saldría **dos veces**
    // cada noche: una a las 21:00 y otra al día siguiente.
    const nocheEnAsuncion = new Date('2026-08-12T23:30:00Z'); // 20:30 PY del 12
    const masTardeMismoDiaPY = new Date('2026-08-13T02:00:00Z'); // 23:00 PY del 12 — otro día en UTC

    await claimJob('resumen_diario', { onceEvery: 'dia', now: nocheEnAsuncion });
    await finishJob('resumen_diario', { ok: true, now: nocheEnAsuncion });

    const segunda = await claimJob('resumen_diario', {
      onceEvery: 'dia',
      now: masTardeMismoDiaPY,
    });
    expect(segunda).toEqual({ claimed: false, reason: 'ya_corrio_hoy' });
  });
});

describe.skipIf(!hasTestDb)('claimJob — lock del backup', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('una corrida viva bloquea a la siguiente', async () => {
    const primera = await claimJob('backup', { lockMinutes: 30, now: MEDIODIA_PY });
    expect(primera).toEqual({ claimed: true });

    const segunda = await claimJob('backup', {
      lockMinutes: 30,
      now: new Date(MEDIODIA_PY.getTime() + 60_000),
    });
    expect(segunda).toEqual({ claimed: false, reason: 'en_curso' });
  });

  it('terminada la primera, la siguiente entra', async () => {
    await claimJob('backup', { lockMinutes: 30, now: MEDIODIA_PY });
    await finishJob('backup', { ok: true, now: MEDIODIA_PY });

    const segunda = await claimJob('backup', {
      lockMinutes: 30,
      now: new Date(MEDIODIA_PY.getTime() + 60_000),
    });
    expect(segunda).toEqual({ claimed: true });
  });

  it('el lock expira: un proceso muerto no lo deja tomado para siempre', async () => {
    // Un proceso que se muere nunca llama a `finishJob`. Sin expiración, el
    // backup quedaría apagado y nadie se enteraría hasta que hiciera falta.
    await claimJob('backup', { lockMinutes: 30, now: MEDIODIA_PY });

    const despues = await claimJob('backup', {
      lockMinutes: 30,
      now: new Date(MEDIODIA_PY.getTime() + 31 * 60_000),
    });
    expect(despues).toEqual({ claimed: true });
  });

  it('dos claim simultáneos: gana uno solo', async () => {
    // El caso de verdad: dos requests del cron que llegan juntos. La decisión
    // se toma con `SELECT … FOR UPDATE` adentro de una transacción, así que el
    // segundo espera al primero y recién entonces lee el estado ya escrito.
    // Con un SELECT suelto, los dos leerían "libre" y los dos correrían.
    const [a, b] = await Promise.all([
      claimJob('backup', { lockMinutes: 30, now: MEDIODIA_PY }),
      claimJob('backup', { lockMinutes: 30, now: MEDIODIA_PY }),
    ]);

    expect([a.claimed, b.claimed].filter(Boolean)).toHaveLength(1);
  });

  it('dos resúmenes simultáneos el mismo día: se manda uno solo', async () => {
    await claimJob('resumen_diario', { onceEvery: 'dia', now: MEDIODIA_PY });
    await finishJob('resumen_diario', { ok: true, now: MEDIODIA_PY });

    const despues = new Date(MEDIODIA_PY.getTime() + 15 * 60_000);
    const [a, b] = await Promise.all([
      claimJob('resumen_diario', { onceEvery: 'dia', now: despues }),
      claimJob('resumen_diario', { onceEvery: 'dia', now: despues }),
    ]);

    expect(a.claimed).toBe(false);
    expect(b.claimed).toBe(false);
  });
});

describe.skipIf(!hasTestDb)('finishJob', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('el éxito mueve last_ok_at y limpia el error', async () => {
    await claimJob('resumen_diario', { now: MEDIODIA_PY });
    await finishJob('resumen_diario', { ok: false, error: 'algo', now: MEDIODIA_PY });
    await claimJob('resumen_diario', { now: MEDIODIA_PY });
    await finishJob('resumen_diario', { ok: true, now: MEDIODIA_PY, payload: { sent: true } });

    const fila = await getJobRun('resumen_diario');
    expect(fila?.lastOkAt).not.toBeNull();
    expect(fila?.lastError).toBeNull();
    expect(fila?.finishedAt).not.toBeNull();
    expect(fila?.payload).toEqual({ sent: true });
  });

  it('el fallo deja el motivo, sin saltos de línea ni stack', async () => {
    await claimJob('backup', { now: MEDIODIA_PY });
    await finishJob('backup', {
      ok: false,
      error: 'Cloudinary  dijo\n  que no\n    at foo (bar.ts:1)',
      now: MEDIODIA_PY,
    });

    const fila = await getJobRun('backup');
    expect(fila?.lastError).toBe('Cloudinary dijo que no at foo (bar.ts:1)');
    expect(fila?.lastOkAt).toBeNull();
  });

  it('el motivo se recorta a la columna', async () => {
    await claimJob('backup', { now: MEDIODIA_PY });
    await finishJob('backup', { ok: false, error: 'x'.repeat(900), now: MEDIODIA_PY });

    const [fila] = await getTestDb().select().from(jobRuns).where(eq(jobRuns.job, 'backup'));
    expect(fila?.lastError).toHaveLength(500);
  });
});

/**
 * El latido de `vencer-pedidos`: el cron que vence pedidos, libera stock y
 * manda recordatorios. Sin cron configurado en el hPanel nada falla a la
 * vista; el resumen del panel lo avisa con esto.
 */
describe.skipIf(!hasTestDb)('recordJobRun y cronAtrasado', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('nunca corrió → atrasado; una corrida buena lo pone al día', async () => {
    expect(cronAtrasado(await getJobRun('vencer_pedidos'))).toBe(true);

    await recordJobRun('vencer_pedidos', { ok: true, payload: { vencidos: 0 } });
    const run = await getJobRun('vencer_pedidos');
    expect(run?.lastOkAt).not.toBeNull();
    expect(cronAtrasado(run)).toBe(false);
  });

  it('un fallo no mueve el último éxito, y dos horas sin éxito es atrasado', async () => {
    const hace3h = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await recordJobRun('vencer_pedidos', { ok: true, now: hace3h });
    await recordJobRun('vencer_pedidos', { ok: false, error: 'ECONNREFUSED' });

    const run = await getJobRun('vencer_pedidos');
    expect(run?.lastError).toBe('ECONNREFUSED');
    expect(cronAtrasado(run)).toBe(true);
  });
});
