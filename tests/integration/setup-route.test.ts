import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { products, setupState, shippingZones, users } from '../../src/db/schema';
import { resetRateLimits } from '../../src/lib/rate-limit';
import { verifyPassword } from '../../src/lib/password';
import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';

/**
 * `POST /api/setup/init` (DEPLOY.md §4).
 *
 * Es la ruta más peligrosa del repo: corre migraciones, siembra y puede
 * cambiarle la contraseña al dueño. Lo único que la separa de cualquiera en
 * internet es `SETUP_SECRET`, así que la mitad de estos tests son sobre la
 * puerta —los mismos que los del cron— y la otra mitad sobre que no se pueda
 * pisar dos veces una tienda que ya está andando.
 */
const SECRET = 'secreto-de-setup-para-los-tests-1234567890';

describe.skipIf(!hasTestDb)('POST /api/setup/init', () => {
  const originalSecret = process.env.SETUP_SECRET;

  beforeEach(async () => {
    await resetTables();
    resetRateLimits();
    process.env.SETUP_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.SETUP_SECRET = originalSecret;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  /** Se importa adentro de cada test para que lea el env ya seteado. */
  async function route() {
    return import('../../src/app/api/setup/init/route');
  }

  function request(init: { secret?: string; body?: unknown; proto?: string } = {}): Request {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (init.secret !== undefined) headers.authorization = `Bearer ${init.secret}`;
    if (init.proto !== undefined) headers['x-forwarded-proto'] = init.proto;

    return new Request('http://localhost/api/setup/init', {
      method: 'POST',
      headers,
      body: JSON.stringify(init.body ?? {}),
    });
  }

  async function inicializar(body: unknown) {
    const { POST } = await route();
    return POST(request({ secret: SECRET, body }));
  }

  // --- La puerta ------------------------------------------------------------

  it('sin SETUP_SECRET configurado la ruta queda cerrada', async () => {
    process.env.SETUP_SECRET = '';
    const { POST } = await route();

    const response = await POST(request({ secret: SECRET, body: { seed: true } }));

    // 503 y no 200: es el estado en el que queda la tienda después del setup,
    // cuando se borra la variable del hPanel.
    expect(response.status).toBe(503);
    expect(await contarProductos()).toBe(0);
  });

  it('un secreto demasiado corto es lo mismo que no tenerlo', async () => {
    process.env.SETUP_SECRET = 'corto';
    const { POST } = await route();

    const response = await POST(request({ secret: 'corto', body: {} }));
    expect(response.status).toBe(503);
  });

  it('sin secreto y con el secreto equivocado devuelve 401 sin hacer nada', async () => {
    const { POST } = await route();

    const sinHeader = await POST(request({ body: { seed: true } }));
    const conSecretoMalo = await POST(
      request({ secret: 'no-es-el-secreto-pero-mide-parecido!!', body: { seed: true } }),
    );

    expect(sinHeader.status).toBe(401);
    expect(conSecretoMalo.status).toBe(401);
    // Y el 401 no dice si faltó el header o si el secreto está mal.
    expect(await sinHeader.json()).toEqual(await conSecretoMalo.json());
    expect(await contarProductos()).toBe(0);
  });

  it('un secreto del largo correcto pero distinto tampoco pasa', async () => {
    const { POST } = await route();

    // Mismo largo: descarta que el guard esté comparando sólo longitudes.
    const casiIgual = `${SECRET.slice(0, -1)}X`;
    expect(casiIgual).toHaveLength(SECRET.length);

    expect((await POST(request({ secret: casiIgual, body: {} }))).status).toBe(401);
  });

  it('corta por rate limit antes de dejar probar secretos sin fin', async () => {
    const { POST } = await route();

    let limited: Response | undefined;
    for (let i = 0; i < 30; i += 1) {
      const response = await POST(request({ secret: 'intento-de-fuerza-bruta', body: {} }));
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited?.status).toBe(429);
  });

  it('la respuesta no se cachea', async () => {
    const response = await inicializar({});
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  // --- El trabajo -----------------------------------------------------------

  it('con el secreto correcto migra, siembra y crea al dueño', async () => {
    const response = await inicializar({
      seed: true,
      owner: { email: '  Duenio@Tienda.com.py ', password: 'contrasenia123', name: 'Rosa' },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      pasos: Record<string, string>;
      usuarios: number;
      primeraVez: boolean;
    };

    expect(body.ok).toBe(true);
    expect(body.primeraVez).toBe(true);
    expect(body.pasos.migraciones).toBe('aplicadas');
    expect(body.pasos.seed).toBe('sembrado');
    expect(body.pasos.duenio).toBe('creado');
    expect(body.usuarios).toBe(1);

    expect(await contarProductos()).toBeGreaterThan(0);

    // El email se normaliza igual que en `pnpm create-owner`.
    const dueño = await buscarUsuario('duenio@tienda.com.py');
    expect(dueño?.role).toBe('owner');
    expect(await verifyPassword('contrasenia123', dueño?.passwordHash)).toBe(true);
  });

  it('la respuesta no lleva ids, ni emails, ni la contraseña', async () => {
    const texto = await (
      await inicializar({
        seed: true,
        owner: { email: 'duenio@tienda.com.py', password: 'contrasenia123' },
      })
    ).text();

    expect(texto).not.toContain('duenio@tienda.com.py');
    expect(texto).not.toContain('contrasenia123');

    // Ids de la base, que es lo que este control siempre quiso decir: un
    // `"id": 7`. Desde el PR U la respuesta trae el reporte de preflight, y
    // cada control tiene un `"id"` que es un **slug** estable para grepear en
    // el log del deploy (`"marca"`, `"cron_secret"`) — no una fila de ninguna
    // tabla. Buscar la palabra "id" a secas convertía este guard en un
    // detector de la palabra y no de la filtración.
    expect(texto).not.toMatch(/"id"\s*:\s*\d/);
    expect(texto).not.toMatch(/"\w*[iI]d"\s*:\s*\d/);
  });

  it('sin pedir nada sólo migra: es el corredor de migraciones de los deploys siguientes', async () => {
    const response = await inicializar({});

    expect(response.status).toBe(200);
    const body = (await response.json()) as { pasos: Record<string, string> };
    expect(body.pasos.migraciones).toBe('aplicadas');
    expect(body.pasos.seed).toBe('no pedido');
    expect(await contarProductos()).toBe(0);
  });

  it('un segundo `{}` sigue siendo 200: migrar es idempotente', async () => {
    await inicializar({});
    const segunda = await inicializar({});

    expect(segunda.status).toBe(200);
    expect(((await segunda.json()) as { primeraVez: boolean }).primeraVez).toBe(false);
  });

  // --- Una sola vez ---------------------------------------------------------

  it('la segunda llamada con seed devuelve 409 y no vuelve a sembrar', async () => {
    await inicializar({ seed: true, owner: { email: 'a@b.com', password: 'contrasenia123' } });
    const productosAntes = await contarProductos();

    const segunda = await inicializar({
      seed: true,
      owner: { email: 'otro@b.com', password: 'contrasenia123' },
    });

    expect(segunda.status).toBe(409);
    const body = (await segunda.json()) as {
      ok: boolean;
      error: string;
      yaEstaba: { seed: boolean; duenio: boolean; corridas: number };
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('ya_inicializada');
    // El resumen dice qué había de antes, que es lo que el que llamó quiere
    // saber para decidir si forzar.
    expect(body.yaEstaba).toMatchObject({ seed: true, duenio: true });
    expect(body.yaEstaba.corridas).toBeGreaterThanOrEqual(1);

    expect(await contarProductos()).toBe(productosAntes);
    // Y el dueño nuevo no se creó.
    expect(await buscarUsuario('otro@b.com')).toBeUndefined();
  });

  it('con force:true vuelve a sembrar y actualiza la contraseña del dueño', async () => {
    await inicializar({
      seed: true,
      owner: { email: 'duenio@tienda.com.py', password: 'contrasenia123' },
    });

    const forzada = await inicializar({
      force: true,
      seed: true,
      owner: { email: 'duenio@tienda.com.py', password: 'otracontra456' },
    });

    expect(forzada.status).toBe(200);
    const body = (await forzada.json()) as { pasos: Record<string, string>; usuarios: number };
    expect(body.pasos.seed).toBe('sembrado');
    expect(body.pasos.duenio).toBe('actualizado');
    // Actualizado, no duplicado.
    expect(body.usuarios).toBe(1);

    const dueño = await buscarUsuario('duenio@tienda.com.py');
    expect(await verifyPassword('otracontra456', dueño?.passwordHash)).toBe(true);
    expect(await verifyPassword('contrasenia123', dueño?.passwordHash)).toBe(false);
  });

  it('la marca queda escrita con lo que efectivamente corrió', async () => {
    await inicializar({});
    const soloMigrado = await marca();
    expect(soloMigrado?.seededAt).toBeNull();
    expect(soloMigrado?.ownerAt).toBeNull();

    await inicializar({ force: true, seed: true });
    const conSeed = await marca();
    expect(conSeed?.seededAt).not.toBeNull();
    expect(conSeed?.ownerAt).toBeNull();
    expect(conSeed?.runs).toBe(2);
  });

  // --- El cuerpo ------------------------------------------------------------

  it('una contraseña débil se rechaza antes de tocar la base', async () => {
    const response = await inicializar({
      owner: { email: 'duenio@tienda.com.py', password: 'corta' },
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('password_debil');
    expect(await buscarUsuario('duenio@tienda.com.py')).toBeUndefined();
    // Ni siquiera se marcó el setup: no se hizo nada.
    expect(await marca()).toBeUndefined();
  });

  it('una contraseña sin números tampoco pasa, igual que en create-owner', async () => {
    const response = await inicializar({
      owner: { email: 'duenio@tienda.com.py', password: 'solamenteletras' },
    });

    expect(response.status).toBe(400);
  });

  it('un email inválido se rechaza sin reflejar el cuerpo', async () => {
    const response = await inicializar({
      owner: { email: 'no-es-un-email', password: 'contrasenia123' },
    });

    expect(response.status).toBe(400);
    const texto = JSON.stringify(await response.json());
    expect(texto).toContain('cuerpo_invalido');
    expect(texto).not.toContain('contrasenia123');
  });

  // --- Zonas de envío y preflight (PLAN.md FASE 2, PR U) --------------------

  it('acepta las zonas reales de la tienda en el cuerpo', async () => {
    // El paso que faltaba para no tener que abrir /admin a cargarlas a mano
    // en cada tienda nueva.
    const response = await inicializar({
      zonas: [
        { slug: 'asuncion', name: 'Asunción', cities: ['Asunción'], pricePyg: 25000, freeThresholdPyg: 500000 },
        { slug: 'interior', name: 'Interior', cities: [], pricePyg: 80000 },
      ],
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { pasos: Record<string, string> };
    expect(body.pasos.zonas).toContain('2');

    const zonas = await getTestDb().select().from(shippingZones);
    expect(zonas.map((zona) => zona.slug).sort()).toEqual(['asuncion', 'interior']);
    // Sin `position` explícita manda el orden del array: es lo que quiso decir
    // quien escribió el curl.
    expect(zonas.find((zona) => zona.slug === 'asuncion')?.position).toBe(0);
    expect(zonas.find((zona) => zona.slug === 'interior')?.position).toBe(1);
    expect(zonas.find((zona) => zona.slug === 'interior')?.freeThresholdPyg).toBeNull();
  });

  it('el upsert es por slug: repetir no duplica, y no borra lo que no viene', async () => {
    await inicializar({
      zonas: [{ slug: 'asuncion', name: 'Asunción', cities: ['Asunción'], pricePyg: 25000 }],
    });

    await inicializar({
      force: true,
      zonas: [{ slug: 'asuncion', name: 'Gran Asunción', cities: ['Asunción', 'Luque'], pricePyg: 30000 }],
    });

    const zonas = await getTestDb().select().from(shippingZones);
    expect(zonas).toHaveLength(1);
    expect(zonas[0]?.name).toBe('Gran Asunción');
    expect(zonas[0]?.pricePyg).toBe(30000);
  });

  it('un flete con decimales no entra: la plata es entera', async () => {
    const response = await inicializar({
      zonas: [{ slug: 'asuncion', name: 'Asunción', cities: [], pricePyg: 25000.5 }],
    });

    expect(response.status).toBe(400);
    expect(await getTestDb().select().from(shippingZones)).toEqual([]);
  });

  it('mandar zonas a una tienda ya inicializada pide force, igual que el seed', async () => {
    await inicializar({ seed: true });

    const response = await inicializar({
      zonas: [{ slug: 'nueva', name: 'Nueva', cities: [], pricePyg: 1000 }],
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { pasos: Record<string, string> };
    expect(body.pasos.zonas).toContain('salteadas');
    expect(
      (await getTestDb().select().from(shippingZones)).some((zona) => zona.slug === 'nueva'),
    ).toBe(false);
  });

  it('la respuesta trae el reporte de preflight del servidor', async () => {
    // Esto es lo que mata el paso "corré pnpm preflight desde tu máquina
    // contra el env de prod": lo contesta el proceso que va a atender a las
    // compradoras, con las variables que de verdad tiene cargadas.
    const response = await inicializar({});
    const body = (await response.json()) as {
      preflight: { ok: boolean; blocking: number; checks: Array<{ id: string; detail: string }> };
    };

    expect(typeof body.preflight.ok).toBe('boolean');
    expect(body.preflight.checks.map((check) => check.id)).toContain('session_secret');

    // Y sigue sin imprimir el valor de ningún secreto: sólo si está y si mide.
    const texto = JSON.stringify(body.preflight);
    expect(texto).not.toContain(SECRET);
    expect(texto).not.toContain(process.env.SESSION_SECRET ?? '\u0000no-hay');
  });

  it('en producción exige https', async () => {
    // El secreto viaja en un header y la contraseña en el cuerpo: por http en
    // claro los dos quedan en cualquier proxy del camino.
    vi.stubEnv('NODE_ENV', 'production');

    try {
      const { POST } = await route();

      const porHttp = await POST(request({ secret: SECRET, body: {}, proto: 'http' }));
      expect(porHttp.status).toBe(400);
      expect(((await porHttp.json()) as { error: string }).error).toBe('https_required');

      const porHttps = await POST(request({ secret: SECRET, body: {}, proto: 'https' }));
      expect(porHttps.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

async function contarProductos(): Promise<number> {
  return (await getTestDb().select({ id: products.id }).from(products)).length;
}

async function buscarUsuario(email: string) {
  return (await getTestDb().select().from(users).where(eq(users.email, email)).limit(1))[0];
}

async function marca() {
  return (await getTestDb().select().from(setupState).where(eq(setupState.id, 1)).limit(1))[0];
}
