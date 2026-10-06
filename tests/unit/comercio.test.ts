import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `src/lib/comercio.ts` — datos del comercio leídos del entorno del servidor.
 *
 * PLAN 3.4: sin datos bancarios reales cargados, la página del pedido tiene
 * que avisarlo en vez de mostrar un banco o un RUC inventados. Este test
 * fija ese comportamiento para las dos puntas: falta todo, y falta un solo
 * campo.
 *
 * Desde el PR T el entorno es **el fallback** y no la única fuente: la tabla
 * `bank_details` gana cuando está cargada. Acá se prueba sólo la mitad que no
 * toca la base —`datosBancariosDeEnv`, que sigue siendo síncrona a propósito—
 * y la precedencia entre las dos fuentes vive en
 * `tests/integration/admin-bank.test.ts`, que es donde hay una base para que
 * una fila le gane a una variable.
 */

const BANCO_VARS = [
  'BANCO_NOMBRE',
  'BANCO_TITULAR',
  'BANCO_RUC',
  'BANCO_CUENTA',
  'BANCO_TIPO_CUENTA',
  'BANCO_QR_URL',
] as const;

function clearBancoEnv(): void {
  vi.resetModules();
  for (const name of BANCO_VARS) vi.stubEnv(name, '');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('datosBancariosDeEnv', () => {
  it('devuelve null si no hay ningún dato bancario configurado', async () => {
    clearBancoEnv();
    const { datosBancariosDeEnv } = await import('../../src/lib/comercio');
    expect(datosBancariosDeEnv()).toBeNull();
  });

  it('devuelve null si falta un solo campo obligatorio', async () => {
    clearBancoEnv();
    vi.stubEnv('BANCO_NOMBRE', 'Banco Itaú');
    vi.stubEnv('BANCO_TITULAR', 'Comercial San Roque S.A.');
    vi.stubEnv('BANCO_RUC', '80012345-6');
    vi.stubEnv('BANCO_CUENTA', '1234567890');
    // BANCO_TIPO_CUENTA queda vacío a propósito.
    vi.resetModules();

    const { datosBancariosDeEnv } = await import('../../src/lib/comercio');
    expect(datosBancariosDeEnv()).toBeNull();
  });

  it('devuelve los datos completos, con qrUrl null si no está configurado', async () => {
    clearBancoEnv();
    vi.stubEnv('BANCO_NOMBRE', 'Banco Itaú');
    vi.stubEnv('BANCO_TITULAR', 'Comercial San Roque S.A.');
    vi.stubEnv('BANCO_RUC', '80012345-6');
    vi.stubEnv('BANCO_CUENTA', '1234567890');
    vi.stubEnv('BANCO_TIPO_CUENTA', 'Cuenta corriente');
    vi.resetModules();

    const { datosBancariosDeEnv } = await import('../../src/lib/comercio');
    expect(datosBancariosDeEnv()).toEqual({
      banco: 'Banco Itaú',
      titular: 'Comercial San Roque S.A.',
      ruc: '80012345-6',
      cuenta: '1234567890',
      tipoCuenta: 'Cuenta corriente',
      qrUrl: null,
    });
  });

  it('incluye qrUrl cuando está configurado', async () => {
    clearBancoEnv();
    vi.stubEnv('BANCO_NOMBRE', 'Banco Itaú');
    vi.stubEnv('BANCO_TITULAR', 'Comercial San Roque S.A.');
    vi.stubEnv('BANCO_RUC', '80012345-6');
    vi.stubEnv('BANCO_CUENTA', '1234567890');
    vi.stubEnv('BANCO_TIPO_CUENTA', 'Cuenta corriente');
    vi.stubEnv('BANCO_QR_URL', '/banco-qr.png');
    vi.resetModules();

    const { datosBancariosDeEnv } = await import('../../src/lib/comercio');
    expect(datosBancariosDeEnv()?.qrUrl).toBe('/banco-qr.png');
  });
});

describe('comercioWaLink', () => {
  it('devuelve null sin WHATSAPP_NUMBER configurado', async () => {
    vi.resetModules();
    vi.stubEnv('WHATSAPP_NUMBER', '');

    const { comercioWaLink } = await import('../../src/lib/comercio');
    expect(comercioWaLink('hola')).toBeNull();
  });

  it('arma el link de wa.me con el número normalizado', async () => {
    vi.resetModules();
    vi.stubEnv('WHATSAPP_NUMBER', '0981123456');

    const { comercioWaLink } = await import('../../src/lib/comercio');
    const link = comercioWaLink('Hola!');
    expect(link).toBe('https://wa.me/595981123456?text=Hola!');
  });
});

describe('un solo armador de links de WhatsApp', () => {
  it('nadie construye la URL de wa.me a mano', async () => {
    // Hay cuatro lugares que mandan a WhatsApp —ficha de producto, carrito,
    // aviso al dueño y el mensaje al comprador desde el panel— y todos pasan
    // por `waLink`/`comercioWaLink`. Un segundo armador es un lugar más donde
    // olvidarse del `encodeURIComponent` o del recorte de largo.
    const { listSourceFiles, readCode } = await import('../helpers/source');
    const ALLOWED = new Set([path.join('src', 'lib', 'py.ts')]);

    const offenders: string[] = [];
    for (const file of await listSourceFiles(['src'])) {
      if (ALLOWED.has(file)) continue;
      if (/wa\.me\//.test(await readCode(file))) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
