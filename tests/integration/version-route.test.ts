import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetRateLimits } from '@/lib/rate-limit';

/**
 * `/api/version` (O8, plan-operacion §5.4 B).
 *
 * Contesta "¿tomó el redeploy?", que es la pregunta del día del deploy. Y va
 * **con secreto**: el SHA del build y la versión de Node son información de
 * reconocimiento — con el repo público, le dicen a cualquiera qué commit exacto
 * está corriendo, o sea la lista de vulnerabilidades conocidas de esta
 * instalación.
 */
const SECRET = 'secreto-de-cron-para-los-tests-1234567890';

describe('GET /api/version', () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    resetRateLimits();
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.CRON_SECRET = original;
    resetRateLimits();
  });

  async function route() {
    return import('@/app/api/version/route');
  }

  function request(secret?: string): Request {
    return new Request('http://localhost/api/version', {
      headers: secret === undefined ? {} : { authorization: `Bearer ${secret}` },
    });
  }

  it('sin secreto, 401 y no dice nada del build', async () => {
    const { GET } = await route();
    const response = await GET(request());

    expect(response.status).toBe(401);
    const cuerpo = await response.text();
    expect(cuerpo).not.toContain('node');
    expect(cuerpo).not.toContain(process.version);
  });

  it('con el secreto, devuelve sha, builtAt y node', async () => {
    const { GET } = await route();
    const response = await GET(request(SECRET));
    const cuerpo = (await response.json()) as Record<string, string>;

    expect(response.status).toBe(200);
    expect(Object.keys(cuerpo).sort()).toEqual(['builtAt', 'node', 'sha']);
    expect(cuerpo.node).toBe(process.version);
  });

  it('sin BUILD_SHA dice "desconocido", no un valor inventado', async () => {
    const { GET } = await route();
    const cuerpo = (await (await GET(request(SECRET))).json()) as { sha: string };
    expect(typeof cuerpo.sha).toBe('string');
    expect(cuerpo.sha.length).toBeGreaterThan(0);
  });

  it('no se cachea: lo que devuelve es el build de ahora', async () => {
    const { GET } = await route();
    const response = await GET(request(SECRET));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
