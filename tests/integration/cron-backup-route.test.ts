import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getJobRun } from '@/domain/job-runs';
import { resetRateLimits } from '@/lib/rate-limit';

import { closeTestDb, hasTestDb, resetTables } from '../helpers/db';

/**
 * La ruta del backup (O8, plan-operacion §5.4 A).
 *
 * Lo que se fija acá es la puerta y el lock. El dump en sí lo cubre
 * `backup.test.ts`; subir a Cloudinary de verdad no se testea —haría falta una
 * cuenta y subiría basura en cada corrida de CI.
 */
const SECRET = 'secreto-de-cron-para-los-tests-1234567890';

describe.skipIf(!hasTestDb)('GET/POST /api/cron/backup', () => {
  const original = process.env.CRON_SECRET;

  beforeEach(async () => {
    await resetTables();
    resetRateLimits();
    vi.unstubAllEnvs();
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.CRON_SECRET = original;
    vi.unstubAllEnvs();
  });

  afterAll(closeTestDb);

  async function route() {
    return import('@/app/api/cron/backup/route');
  }

  function request(secret?: string): Request {
    return new Request('http://localhost/api/cron/backup', {
      headers: secret === undefined ? {} : { authorization: `Bearer ${secret}` },
    });
  }

  it('sin secreto, 401 y no toca el lock', async () => {
    const { GET } = await route();
    expect((await GET(request())).status).toBe(401);
    expect(await getJobRun('backup')).toBeNull();
  });

  it('sin CRON_SECRET configurado, 503', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await route();
    expect((await GET(request('lo-que-sea'))).status).toBe(503);
  });

  it('sin Cloudinary se saltea con 200, no con un error', async () => {
    // No es una falla de esta corrida: es una tienda que no configuró la
    // feature. Un status de error haría que Hostinger reintente para siempre.
    for (const name of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
      vi.stubEnv(name, '');
    }

    const { GET } = await route();
    const response = await GET(request(SECRET));
    const cuerpo = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(cuerpo.skipped).toBe('sin_cloudinary');
    expect(cuerpo.uploaded).toBe(false);
    // Y no tomó el lock: la corrida de mañana tiene que poder entrar.
    expect(await getJobRun('backup')).toBeNull();
  });

  it('la respuesta no incluye el nombre del archivo', async () => {
    // El `public_id` es media pista para encontrar el backup, y esta respuesta
    // la ve cualquiera con acceso a los logs del hPanel.
    for (const name of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
      vi.stubEnv(name, '');
    }

    const { GET } = await route();
    const cuerpo = await (await GET(request(SECRET))).text();
    expect(cuerpo).not.toContain('publicId');
    expect(cuerpo).not.toContain('backup-20');
  });

  it('acepta POST además de GET', async () => {
    for (const name of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
      vi.stubEnv(name, '');
    }

    const { POST } = await route();
    expect((await POST(request(SECRET))).status).toBe(200);
  });
});
