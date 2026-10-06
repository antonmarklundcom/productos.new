import { afterAll, describe, expect, it, vi } from 'vitest';

import { recordJobRun } from '@/domain/job-runs';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';

/**
 * `GET /api/health` — la prueba de humo post-deploy (DEPLOY.md §6).
 *
 * Es la única ruta de la app sin autenticar, así que lo que se prueba es tanto
 * lo que **dice** (levantó / llega a la base) como lo que **no dice**: nada de
 * versiones, nombres de base ni errores de MySQL, que es información gratis
 * para el que está mirando qué hay del otro lado.
 */
describe.skipIf(!hasTestDb)('GET /api/health', () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it('con la base arriba responde ok y db en true; cron en false hasta que corra', async () => {
    // Fuerza a que el pool exista antes de llamar a la ruta.
    getTestDb();
    await resetTables();
    const { GET } = await import('../../src/app/api/health/route');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, db: true, cron: false });

    // Un monitor por palabra clave (DEPLOY.md §8) ve el cron andando.
    await recordJobRun('vencer_pedidos', { ok: true });
    expect(await (await GET()).text()).toContain('"db":true,"cron":true');
  });

  it('la respuesta no se cachea', async () => {
    const { GET } = await import('../../src/app/api/health/route');
    const response = await GET();

    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('no filtra versiones, nombre de base ni detalle del error', async () => {
    const { GET } = await import('../../src/app/api/health/route');
    const body = await (await GET()).text();

    // Booleanos y nada más.
    expect(Object.keys(JSON.parse(body) as object).sort()).toEqual(['cron', 'db', 'ok']);
    expect(body).not.toMatch(/mysql|maria|version|8\.\d|schema/i);
  });
});

describe('GET /api/health sin base', () => {
  it('sigue respondiendo 200 con db en false en vez de reventar', async () => {
    // Sin base, la app igual levantó: eso es exactamente lo que el health
    // check tiene que poder decir. Un 500 acá no distingue "el proceso está
    // muerto" de "no llega a MySQL", que son dos problemas distintos.
    vi.doMock('@/db', () => ({
      getPool: () => {
        throw new Error('DATABASE_URL no está definida');
      },
    }));
    vi.resetModules();

    const { GET } = await import('../../src/app/api/health/route');
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, db: false, cron: false });

    vi.doUnmock('@/db');
    vi.resetModules();
  });
});
