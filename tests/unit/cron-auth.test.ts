import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CRON_SECRET_MIN_LENGTH, cronJson, requireCronSecret } from '@/lib/cron-auth';
import { CRON_LIMIT, resetRateLimits } from '@/lib/rate-limit';

/**
 * La puerta compartida de las rutas de cron (O6, plan-operacion §5.2 A).
 *
 * Nació adentro de `/api/cron/vencer-pedidos` y se extrajo porque aparecieron
 * tres rutas más. El riesgo de una extracción así es exactamente lo que estos
 * tests fijan: que ninguna de las cuatro decisiones de seguridad se pierda en
 * el camino, porque una copia a la que le falta el rate limit convierte al
 * endpoint nuevo en el más débil de los cuatro.
 */
const SECRET = 'secreto-de-cron-para-los-tests-1234567890';

function request(init: { secret?: string; query?: string } = {}): Request {
  return new Request(`http://localhost/api/cron/lo-que-sea${init.query ?? ''}`, {
    headers: init.secret === undefined ? {} : { authorization: `Bearer ${init.secret}` },
  });
}

describe('requireCronSecret', () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    resetRateLimits();
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.CRON_SECRET = original;
    resetRateLimits();
  });

  it('con el secreto correcto en el header, pasa', () => {
    expect(requireCronSecret(request({ secret: SECRET }))).toEqual({ ok: true });
  });

  it('acepta ?secret=: hay crons de Hostinger que no mandan headers', () => {
    expect(requireCronSecret(request({ query: `?secret=${SECRET}` }))).toEqual({ ok: true });
  });

  it('sin nada presentado, 401', async () => {
    const resultado = requireCronSecret(request());
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.response.status).toBe(401);
  });

  it('el 401 no distingue "falta el header" de "el secreto está mal"', async () => {
    const sinHeader = requireCronSecret(request());
    resetRateLimits();
    const conSecretoMalo = requireCronSecret(request({ secret: 'x'.repeat(SECRET.length) }));

    expect(sinHeader.ok).toBe(false);
    expect(conSecretoMalo.ok).toBe(false);
    if (sinHeader.ok || conSecretoMalo.ok) return;

    // Mismo status y mismo cuerpo: la diferencia sería información gratis.
    expect(conSecretoMalo.response.status).toBe(sinHeader.response.status);
    expect(await conSecretoMalo.response.text()).toBe(await sinHeader.response.text());
  });

  it('sin la variable configurada, 503 — la ruta no queda abierta', async () => {
    delete process.env.CRON_SECRET;
    const resultado = requireCronSecret(request({ secret: 'lo-que-sea' }));

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.response.status).toBe(503);
  });

  it('un secreto corto cuenta como no configurado', async () => {
    // Un secreto adivinable no es un secreto, y aceptarlo "hasta que lo
    // cambien" deja la ruta abierta en la práctica.
    process.env.CRON_SECRET = 'x'.repeat(CRON_SECRET_MIN_LENGTH - 1);
    const resultado = requireCronSecret(request({ secret: process.env.CRON_SECRET }));

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.response.status).toBe(503);
  });

  it('el rate limit corta el martilleo de secretos', async () => {
    // La comparación es en tiempo constante, pero eso no impide probar
    // secretos de a millones contra un endpoint público.
    for (let i = 0; i < CRON_LIMIT; i += 1) {
      requireCronSecret(request({ secret: 'x'.repeat(SECRET.length) }));
    }

    const pasado = requireCronSecret(request({ secret: SECRET }));
    expect(pasado.ok).toBe(false);
    if (pasado.ok) return;
    expect(pasado.response.status).toBe(429);
  });

  it('la variable se puede elegir por ruta', () => {
    process.env.OTRO_SECRETO = SECRET;
    try {
      expect(requireCronSecret(request({ secret: SECRET }), { envVar: 'OTRO_SECRETO' })).toEqual({
        ok: true,
      });
    } finally {
      delete process.env.OTRO_SECRETO;
    }
  });
});

describe('cronJson', () => {
  it('siempre no-store: lo que devuelve es el resultado de esta corrida', async () => {
    const response = cronJson({ ok: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ ok: true });
  });
});
