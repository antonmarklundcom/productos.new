import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getJobRun } from '@/domain/job-runs';
import { resetRateLimits } from '@/lib/rate-limit';

import { closeTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder } from '../helpers/factories';

/**
 * La ruta del resumen diario (O6, plan-operacion §5.2 C).
 *
 * Comparte la puerta con `/api/cron/vencer-pedidos` (`src/lib/cron-auth.ts`),
 * así que acá se verifica que la puerta esté puesta y, sobre todo, lo que es
 * propio de esta ruta: **que llamarla diez veces mande un solo mensaje**.
 */
const SECRET = 'secreto-de-cron-para-los-tests-1234567890';

describe.skipIf(!hasTestDb)('GET/POST /api/cron/resumen-diario', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(async () => {
    await resetTables();
    resetRateLimits();
    vi.unstubAllEnvs();
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
    vi.unstubAllEnvs();
  });

  afterAll(closeTestDb);

  /** Se importa adentro de cada test para que lea el env ya seteado. */
  async function route() {
    return import('@/app/api/cron/resumen-diario/route');
  }

  function request(init: { secret?: string; query?: string } = {}): Request {
    const url = `http://localhost/api/cron/resumen-diario${init.query ?? ''}`;
    return new Request(url, {
      headers: init.secret === undefined ? {} : { authorization: `Bearer ${init.secret}` },
    });
  }

  it('sin secreto devuelve 401 y no marca la corrida', async () => {
    const { GET } = await route();
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await getJobRun('resumen_diario')).toBeNull();
  });

  it('con el secreto equivocado, 401', async () => {
    const { GET } = await route();
    expect((await GET(request({ secret: 'otra-cosa-larga-pero-incorrecta' }))).status).toBe(401);
  });

  it('sin CRON_SECRET configurado, 503 — no queda abierta', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await route();
    expect((await GET(request({ secret: 'lo-que-sea' }))).status).toBe(503);
  });

  it('acepta ?secret= además del header: hay crons que no mandan headers', async () => {
    const { GET } = await route();
    const response = await GET(request({ query: `?secret=${SECRET}` }));
    expect(response.status).toBe(200);
  });

  it('corre y devuelve sólo cantidades', async () => {
    await createOrder({ status: 'esperando_verificacion' });

    const { GET } = await route();
    const response = await GET(request({ secret: SECRET }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.comprobantes).toBe(1);
    // Nada de números de pedido ni teléfonos: los logs y las respuestas de
    // Hostinger los ve cualquiera con acceso al hPanel.
    expect(JSON.stringify(body)).not.toMatch(/\+595/);
    expect(JSON.stringify(body)).not.toMatch(/PY-/);
  });

  it('la segunda llamada del día no vuelve a mandar', async () => {
    const { GET } = await route();

    const primera = await (await GET(request({ secret: SECRET }))).json();
    const segunda = await (await GET(request({ secret: SECRET }))).json();

    expect(primera.skipped).toBeUndefined();
    expect(segunda.skipped).toBe('ya_corrio_hoy');
    expect(segunda.sent).toBe(false);
  });

  it('la llamada salteada devuelve 200, no un error', async () => {
    // 200 y no 429: para Hostinger esto **no es un error**. Un status de error
    // lo haría reintentar, y el reintento tampoco mandaría nada.
    const { POST } = await route();
    await POST(request({ secret: SECRET }));
    const segunda = await POST(request({ secret: SECRET }));

    expect(segunda.status).toBe(200);
  });

  it('sin plantilla, corre igual pero no manda', async () => {
    const { GET } = await route();
    const body = await (await GET(request({ secret: SECRET }))).json();

    expect(body.ok).toBe(true);
    expect(body.sent).toBe(false);

    // Y la corrida queda anotada como exitosa: se armó el resumen y se
    // intentó. Marcarla fallida haría que la corrida siguiente del día
    // reintentara y el dueño recibiera el resumen dos veces.
    const fila = await getJobRun('resumen_diario');
    expect(fila?.lastOkAt).not.toBeNull();
    expect(fila?.finishedAt).not.toBeNull();
  });

  it('el payload de la corrida guarda cantidades, no datos de nadie', async () => {
    await createOrder({ status: 'esperando_verificacion' });

    const { GET } = await route();
    await GET(request({ secret: SECRET }));

    const fila = await getJobRun('resumen_diario');
    expect(fila?.payload).toMatchObject({ sent: false, comprobantes: 1 });
    expect(JSON.stringify(fila?.payload)).not.toMatch(/\+595/);
  });
});
