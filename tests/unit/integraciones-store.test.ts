import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `src/lib/integraciones-store.ts` contra una base de mentira: cifra al
 * guardar, descifra al cargar, y **ningún secreto sale** —ni al navegador
 * (`estadoParaPanel`), ni al log, ni en el mensaje de "Probar conexión"—.
 */

type Fila = {
  integration: string;
  data: unknown;
  secrets: unknown;
  updatedAt: Date | null;
  updatedByUserId: number | null;
};

const tabla = new Map<string, Fila>();

// `eq(columna, valor)` → el valor: la base de mentira filtra por integración.
vi.mock('drizzle-orm', async (original) => ({
  ...(await original<typeof import('drizzle-orm')>()),
  eq: (_columna: unknown, valor: unknown) => ({ __eq: valor }),
}));

function consulta(): unknown {
  let filtro: string | null = null;
  const q = {
    where(cond: { __eq: string }) {
      filtro = cond.__eq;
      return q;
    },
    limit: () => q,
    for: () => q,
    then<A, B>(ok?: (filas: Fila[]) => A, mal?: (error: unknown) => B) {
      const filas = [...tabla.values()]
        .filter((fila) => filtro === null || fila.integration === filtro)
        .map((fila) => structuredClone(fila));
      return Promise.resolve(filas).then(ok, mal);
    },
  };
  return q;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- base de mentira, a mano
const baseDeMentira: any = {
  select: () => ({ from: () => consulta() }),
  transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb(baseDeMentira),
  update: () => ({
    set: (valores: Partial<Fila>) => ({
      where: async (cond: { __eq: string }) => {
        const fila = tabla.get(cond.__eq)!;
        tabla.set(cond.__eq, { ...fila, ...structuredClone(valores), updatedAt: new Date() });
      },
    }),
  }),
  insert: () => ({
    values: async (valores: Fila) => {
      tabla.set(valores.integration, { ...structuredClone(valores), updatedAt: new Date() });
    },
  }),
  delete: () => ({
    where: async (cond: { __eq: string }) => {
      tabla.delete(cond.__eq);
    },
  }),
};

vi.mock('@/db', () => ({ getDb: () => baseDeMentira }));

const { resetIntegracionesForTests, CAMPOS, INTEGRACIONES } = await import('../../src/lib/integraciones');
const store = await import('../../src/lib/integraciones-store');
const { probarIntegracion, sanearDetalle } = await import('../../src/lib/integraciones-probar');
const { pagoparPrivateKey, isPagoparConfigured } = await import('../../src/domain/pagopar/config');

const SESSION = 'x'.repeat(20) + 'session-secret-de-los-tests-123';
const CLAVE_PRIVADA = 'pagopar-privada-SUPERSECRETA-9876';
const TOKEN = 'EAAG-token-de-meta-SUPERSECRETO-5555';
const API_SECRET = 'cloudinary-api-secret-SUPERSECRETO-4321';
const SECRETOS = [CLAVE_PRIVADA, TOKEN, API_SECRET];

let lineas: string[] = [];

beforeEach(() => {
  tabla.clear();
  resetIntegracionesForTests();
  for (const nombre of INTEGRACIONES) for (const def of CAMPOS[nombre]) vi.stubEnv(def.env, '');
  vi.stubEnv('PAGOPAR_MODE', '');
  vi.stubEnv('DATABASE_URL', 'mysql://base-de-mentira/tests');
  vi.stubEnv('SESSION_SECRET', SESSION);
  lineas = [];
  const capturar = (...args: unknown[]) => {
    lineas.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  vi.spyOn(console, 'info').mockImplementation(capturar);
  vi.spyOn(console, 'error').mockImplementation(capturar);
  vi.spyOn(console, 'warn').mockImplementation(capturar);
  vi.spyOn(console, 'log').mockImplementation(capturar);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetIntegracionesForTests();
});

function sinSecretos(texto: string): void {
  for (const secreto of SECRETOS) expect(texto).not.toContain(secreto);
}

async function guardarPagopar(): Promise<void> {
  await store.guardarIntegracion(
    'pagopar',
    { valores: { publicKey: 'pub123', privateKey: CLAVE_PRIVADA, baseUrl: 'https://api.pagopar.test/' } },
    { userId: 1 },
  );
}

describe('guardar', () => {
  it('cifra el secreto en la base y la tienda lo usa sin redeploy', async () => {
    await guardarPagopar();

    const fila = tabla.get('pagopar')!;
    sinSecretos(JSON.stringify(fila));
    expect((fila.secrets as Record<string, string>).privateKey).toMatch(/^v1\./);
    expect(fila.data).toEqual({ publicKey: 'pub123', baseUrl: 'https://api.pagopar.test' });
    expect(fila.updatedByUserId).toBe(1);

    // Guardar recarga la foto: el webhook ya firma con la clave nueva.
    expect(pagoparPrivateKey()).toBe(CLAVE_PRIVADA);
    expect(isPagoparConfigured()).toBe(true);
  });

  it('un secreto vacío no se toca; borrarSecretos sí lo borra', async () => {
    await guardarPagopar();
    const antes = (tabla.get('pagopar')!.secrets as Record<string, string>).privateKey;

    const { cambiados } = await store.guardarIntegracion(
      'pagopar',
      { valores: { publicKey: 'pub123', privateKey: '', baseUrl: 'https://api.pagopar.test' } },
      { userId: 1 },
    );
    expect(cambiados).toEqual([]);
    expect((tabla.get('pagopar')!.secrets as Record<string, string>).privateKey).toBe(antes);

    await store.guardarIntegracion('pagopar', { valores: {}, borrarSecretos: ['privateKey'] }, { userId: 1 });
    expect(tabla.get('pagopar')!.secrets).toEqual({});
    expect(isPagoparConfigured()).toBe(false);
  });

  it('un formato inválido no guarda nada', async () => {
    await expect(
      store.guardarIntegracion('analitica', { valores: { ga4Id: 'UA-123' } }, { userId: 1 }),
    ).rejects.toBeInstanceOf(store.IntegracionError);
    await expect(
      store.guardarIntegracion('errores', { valores: { reportUrl: 'http://inseguro.test' } }, { userId: 1 }),
    ).rejects.toBeInstanceOf(store.IntegracionError);
    expect(tabla.size).toBe(0);
  });

  it('un campo que no existe se rechaza', async () => {
    await expect(
      store.guardarIntegracion('pagopar', { valores: { inventado: 'x' } }, { userId: 1 }),
    ).rejects.toBeInstanceOf(store.IntegracionError);
  });

  it('sin SESSION_SECRET válido no se guarda nada', async () => {
    vi.stubEnv('SESSION_SECRET', 'changeme-generate-with-openssl-rand-base64-32');
    await expect(guardarPagopar()).rejects.toBeInstanceOf(store.IntegracionError);
    expect(tabla.size).toBe(0);
  });

  it('volver al entorno borra la fila y manda otra vez la variable', async () => {
    await guardarPagopar();
    vi.stubEnv('PAGOPAR_PUBLIC_KEY', 'pub-env');
    vi.stubEnv('PAGOPAR_PRIVATE_KEY', 'priv-env');
    vi.stubEnv('PAGOPAR_BASE_URL', 'https://env.test');
    await store.borrarIntegracion('pagopar', { userId: 1 });
    expect(tabla.has('pagopar')).toBe(false);
    expect(pagoparPrivateKey()).toBe('priv-env');
  });
});

describe('leer', () => {
  it('sin SESSION_SECRET válido se ignora la tabla entera y manda el entorno', async () => {
    await guardarPagopar();
    resetIntegracionesForTests();
    vi.stubEnv('SESSION_SECRET', '');
    vi.stubEnv('PAGOPAR_PRIVATE_KEY', 'priv-env');
    await store.cargarIntegraciones({ forzar: true });
    expect(pagoparPrivateKey()).toBe('priv-env');
  });

  it('si cambió SESSION_SECRET el secreto queda ilegible y la integración apagada', async () => {
    await guardarPagopar();
    vi.stubEnv('SESSION_SECRET', 'y'.repeat(20) + 'otro-session-secret-distinto-999');
    await store.cargarIntegraciones({ forzar: true });
    expect(pagoparPrivateKey()).toBeNull();

    const { estados } = await store.estadoParaPanel();
    const pagopar = estados.find((estado) => estado.integracion === 'pagopar')!;
    expect(pagopar.campos.find((campo) => campo.campo === 'privateKey')!.ilegible).toBe(true);
    expect(pagopar.resumen.estado).toBe('incompleta');
  });

  it('la base caída no rompe: queda la última foto buena', async () => {
    await guardarPagopar();
    const select = baseDeMentira.select;
    baseDeMentira.select = () => {
      throw new Error('ECONNREFUSED');
    };
    try {
      await store.cargarIntegraciones({ forzar: true });
      expect(pagoparPrivateKey()).toBe(CLAVE_PRIVADA);
    } finally {
      baseDeMentira.select = select;
    }
  });
});

describe('el secreto nunca sale', () => {
  it('ni en lo que se le manda al navegador ni en el log', async () => {
    await guardarPagopar();
    await store.guardarIntegracion(
      'whatsapp',
      { valores: { phoneNumberId: '1234567', accessToken: TOKEN, numeroComercio: '0981123123' } },
      { userId: 1 },
    );
    await store.guardarIntegracion(
      'cloudinary',
      { valores: { cloudName: 'nube', apiKey: '1234', apiSecret: API_SECRET } },
      { userId: 1 },
    );
    await store.cargarIntegraciones({ forzar: true });

    const panel = await store.estadoParaPanel();
    const json = JSON.stringify(panel);
    sinSecretos(json);
    // Lo que sí viaja es la máscara.
    expect(json).toContain('••••9876');
    expect(json).toContain('••••5555');
    const secretosDelPanel = panel.estados.flatMap((estado) =>
      estado.campos.filter((campo) => campo.secreto).map((campo) => campo.valorPanel),
    );
    expect(secretosDelPanel.every((valor) => valor === null)).toBe(true);

    // El log de auditoría dice qué campos cambiaron, nunca los valores.
    expect(lineas.some((linea) => linea.includes('integración guardada'))).toBe(true);
    sinSecretos(lineas.join('\n'));
  });

  it('ni en el mensaje de "Probar conexión", aunque el tercero lo devuelva', async () => {
    await store.guardarIntegracion(
      'whatsapp',
      { valores: { phoneNumberId: '1234567', accessToken: TOKEN } },
      { userId: 1 },
    );
    const fetchFalso = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: `Invalid OAuth access token - ${TOKEN}` } }), {
        status: 401,
      }),
    );
    const resultado = await probarIntegracion('whatsapp', fetchFalso as unknown as typeof fetch);
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain('HTTP 401');
    sinSecretos(resultado.mensaje);
    // El token sí viajó, pero sólo en el header hacia Meta.
    const [, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.stringify(init.headers)).toContain(TOKEN);
  });

  it('Cloudinary: un 200 del ping es "las credenciales andan"', async () => {
    await store.guardarIntegracion(
      'cloudinary',
      { valores: { cloudName: 'nube', apiKey: '1234', apiSecret: API_SECRET } },
      { userId: 1 },
    );
    const fetchFalso = vi.fn<(url: string) => Promise<Response>>(async () => new Response('{"status":"ok"}', { status: 200 }));
    const resultado = await probarIntegracion('cloudinary', fetchFalso as unknown as typeof fetch);
    expect(resultado.ok).toBe(true);
    expect(String(fetchFalso.mock.calls[0]?.[0])).toBe('https://api.cloudinary.com/v1_1/nube/ping');
  });

  it('sin credenciales, la prueba dice qué falta y no llama a nadie', async () => {
    const fetchFalso = vi.fn();
    const resultado = await probarIntegracion('cloudinary', fetchFalso as unknown as typeof fetch);
    expect(resultado.ok).toBe(false);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('sanearDetalle borra el secreto y recorta', () => {
    expect(sanearDetalle(`falló con ${TOKEN}`, [TOKEN])).toBe('falló con ••••');
    expect(sanearDetalle('x'.repeat(500), []).length).toBeLessThanOrEqual(201);
  });
});
