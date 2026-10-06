import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { integrationSettings } from '@/db/schema';
import { pagoparPrivateKey } from '@/domain/pagopar/config';
import { resetIntegracionesForTests } from '@/lib/integraciones';
import {
  cargarIntegraciones,
  estadoParaPanel,
  guardarIntegracion,
  leerIntegracionesDelPanel,
} from '@/lib/integraciones-store';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';

/**
 * `/admin/integraciones` contra MySQL de verdad: la migración crea la tabla,
 * el secreto queda cifrado en la columna, y la tienda lo usa sin redeploy.
 */

const CLAVE = 'clave-privada-de-integracion-7777';

describe.skipIf(!hasTestDb)('integration_settings', () => {
  beforeEach(async () => {
    await resetTables();
    resetIntegracionesForTests();
    vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
    vi.stubEnv('PAGOPAR_PUBLIC_KEY', '');
    vi.stubEnv('PAGOPAR_PRIVATE_KEY', '');
    vi.stubEnv('PAGOPAR_BASE_URL', '');
    vi.stubEnv('PAGOPAR_MODE', '');
  }, 60_000);
  afterEach(() => {
    vi.unstubAllEnvs();
    resetIntegracionesForTests();
  });
  afterAll(closeTestDb);

  it('guarda cifrado, lee descifrado y nunca le da el secreto al panel', async () => {
    await guardarIntegracion(
      'pagopar',
      { valores: { publicKey: 'pub', privateKey: CLAVE, baseUrl: 'https://api.pagopar.test' } },
      { userId: null },
    );

    const [fila] = await getTestDb()
      .select()
      .from(integrationSettings)
      .where(eq(integrationSettings.integration, 'pagopar'));
    expect(JSON.stringify(fila)).not.toContain(CLAVE);
    expect((fila!.secrets as Record<string, string>).privateKey).toMatch(/^v1\./);

    resetIntegracionesForTests();
    await cargarIntegraciones({ forzar: true });
    expect(pagoparPrivateKey()).toBe(CLAVE);

    expect(JSON.stringify(await estadoParaPanel())).not.toContain(CLAVE);

    const panel = await leerIntegracionesDelPanel();
    expect(panel.lectura).toBe('ok');
  });
});
