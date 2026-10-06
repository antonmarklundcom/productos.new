import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { orders } from '../../src/db/schema';
import { resetRateLimits } from '../../src/lib/rate-limit';
import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder, getStatus } from '../helpers/factories';

/**
 * Guard del cron (PLAN.md 4.8 / 4.9).
 *
 * Es una ruta pública que mueve estados de pedidos: lo único que la separa de
 * cualquiera en internet es `CRON_SECRET`. Estos tests son sobre la puerta,
 * no sobre el trabajo que hace adentro.
 */
const SECRET = 'secreto-de-cron-para-los-tests-1234567890';

describe.skipIf(!hasTestDb)('GET/POST /api/cron/vencer-pedidos', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(async () => {
    await resetTables();
    resetRateLimits();
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  /** Se importa adentro de cada test para que lea el env ya seteado. */
  async function route() {
    return import('../../src/app/api/cron/vencer-pedidos/route');
  }

  function request(init: { secret?: string; query?: string } = {}): Request {
    const url = `http://localhost/api/cron/vencer-pedidos${init.query ?? ''}`;
    return new Request(url, {
      headers: init.secret === undefined ? {} : { authorization: `Bearer ${init.secret}` },
    });
  }

  it('sin secreto devuelve 401 y no hace nada', async () => {
    const orderId = await overdueOrder();
    const { GET } = await route();

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await getStatus(orderId)).toBe('pendiente_pago');
  });

  it('con el secreto equivocado devuelve 401', async () => {
    const orderId = await overdueOrder();
    const { GET } = await route();

    const response = await GET(request({ secret: 'no-es-el-secreto-pero-mide-parecido!!' }));

    expect(response.status).toBe(401);
    expect(await getStatus(orderId)).toBe('pendiente_pago');
  });

  it('un secreto del largo correcto pero distinto tampoco pasa', async () => {
    const { GET } = await route();

    // Mismo largo: descarta que el guard esté comparando sólo longitudes.
    const casiIgual = `${SECRET.slice(0, -1)}X`;
    expect(casiIgual).toHaveLength(SECRET.length);

    const response = await GET(request({ secret: casiIgual }));
    expect(response.status).toBe(401);
  });

  it('el 401 no dice si faltó el header o si el secreto está mal', async () => {
    const { GET } = await route();

    const sinHeader = await GET(request());
    const conSecretoMalo = await GET(request({ secret: 'cualquier-cosa' }));

    expect(await sinHeader.json()).toEqual(await conSecretoMalo.json());
  });

  it('con el secreto correcto vence los pedidos y responde el resumen', async () => {
    const orderId = await overdueOrder();
    const { GET } = await route();

    const response = await GET(request({ secret: SECRET }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      expired: 1,
      skipped: 0,
      reservationsDeleted: 0,
      // O15: la misma corrida manda los recordatorios de pago. Sin la
      // plantilla de Meta cargada —el estado de toda tienda que no la pidió—
      // son tres ceros y el cron es exactamente el de antes.
      paymentReminders: { candidatos: 0, enviados: 0, fallidos: 0 },
    });
    expect(await getStatus(orderId)).toBe('vencido');
  });

  it('acepta el secreto por querystring, para los cron que no mandan headers', async () => {
    const orderId = await overdueOrder();
    const { GET } = await route();

    const response = await GET(request({ query: `?secret=${encodeURIComponent(SECRET)}` }));

    expect(response.status).toBe(200);
    expect(await getStatus(orderId)).toBe('vencido');
  });

  it('también responde a POST', async () => {
    const orderId = await overdueOrder();
    const { POST } = await route();

    const response = await POST(request({ secret: SECRET }));

    expect(response.status).toBe(200);
    expect(await getStatus(orderId)).toBe('vencido');
  });

  it('sin CRON_SECRET configurado la ruta queda cerrada', async () => {
    process.env.CRON_SECRET = '';
    const orderId = await overdueOrder();
    const { GET } = await route();

    const response = await GET(request({ secret: SECRET }));

    // 503, no 200: una ruta "abierta hasta que la configuren" es una ruta
    // abierta.
    expect(response.status).toBe(503);
    expect(await getStatus(orderId)).toBe('pendiente_pago');
  });

  it('la respuesta no se cachea', async () => {
    const { GET } = await route();
    const response = await GET(request({ secret: SECRET }));

    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('corta por rate limit antes de dejar probar secretos sin fin', async () => {
    const { GET } = await route();

    let limited: Response | undefined;
    for (let i = 0; i < 60; i += 1) {
      const response = await GET(request({ secret: 'intento-de-fuerza-bruta' }));
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited?.status).toBe(429);
  });
});

async function overdueOrder(): Promise<number> {
  const orderId = await createOrder({ status: 'pendiente_pago' });
  await getTestDb()
    .update(orders)
    .set({ reservedUntil: new Date(Date.now() - 3600_000) })
    .where(eq(orders.id, orderId));
  return orderId;
}
