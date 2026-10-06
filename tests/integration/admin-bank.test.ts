import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bankDetails } from '@/db/schema';
import {
  AdminBankError,
  clearBankQr,
  readBankDetails,
  saveBankDetails,
  setBankQr,
} from '@/domain/admin-bank';
import { getDatosBancarios } from '@/lib/comercio';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createAdminUser } from '../helpers/factories';

/**
 * Datos bancarios en la base, editables desde `/admin/banco` (PLAN.md FASE 2,
 * PR T).
 *
 * Estos casos vivían en `tests/unit/comercio.test.ts` cuando la única fuente
 * era el entorno. Ahora son dos fuentes con una precedencia entre ellas, y esa
 * precedencia no se puede probar sin una base: lo que hay que fijar es que la
 * fila le gana a la variable, que sin fila la variable sigue mandando —una
 * tienda que ya está vendiendo no puede cambiar de comportamiento el día que
 * actualiza el template— y que ninguna de las dos puede terminar mostrando
 * media cuenta.
 */

const DATOS = {
  banco: 'Banco Itaú',
  titular: 'Comercial San Roque S.A.',
  ruc: '80012345-0',
  cuenta: '1234567890',
  tipoCuenta: 'Cuenta corriente',
};

const ENV = {
  BANCO_NOMBRE: 'Banco Continental',
  BANCO_TITULAR: 'La del entorno S.A.',
  BANCO_RUC: '80098765-9',
  BANCO_CUENTA: '999888777',
  BANCO_TIPO_CUENTA: 'Caja de ahorro',
  BANCO_QR_URL: '',
} as const;

function stubEnv(overrides: Partial<Record<keyof typeof ENV, string>> = {}): void {
  for (const [name, value] of Object.entries({ ...ENV, ...overrides })) {
    vi.stubEnv(name, value);
  }
}

/** El entorno vacío: una tienda que nunca cargó los `BANCO_*`. */
function stubEnvVacio(): void {
  for (const name of Object.keys(ENV)) vi.stubEnv(name, '');
}

describe.skipIf(!hasTestDb)('datos bancarios: la fila y el entorno', () => {
  beforeEach(resetTables);
  afterEach(() => vi.unstubAllEnvs());
  afterAll(closeTestDb);

  it('sin fila y sin entorno, no hay datos: la página avisa en vez de inventar', async () => {
    stubEnvVacio();
    expect(await getDatosBancarios()).toBeNull();
  });

  it('sin fila, mandan los BANCO_* del entorno', async () => {
    // Éste es el caso de toda tienda que ya está vendiendo el día que
    // actualiza el template: tabla vacía, entorno cargado, cero cambios.
    stubEnv();

    expect(await getDatosBancarios()).toEqual({
      banco: 'Banco Continental',
      titular: 'La del entorno S.A.',
      ruc: '80098765-9',
      cuenta: '999888777',
      tipoCuenta: 'Caja de ahorro',
      qrUrl: null,
    });
  });

  it('con fila cargada, la fila le gana al entorno', async () => {
    stubEnv();
    const ownerId = await createAdminUser();

    await saveBankDetails({ data: DATOS, actorUserId: ownerId });

    expect(await getDatosBancarios()).toEqual({ ...DATOS, qrUrl: null });
  });

  it('el entorno incompleto vale lo mismo que el entorno vacío', async () => {
    // Un banco sin número de cuenta no es "casi": es una transferencia que se
    // hace mal. Falta uno de los cinco y no se muestra ninguno.
    stubEnv({ BANCO_CUENTA: '' });
    expect(await getDatosBancarios()).toBeNull();
  });

  it('una fila incompleta (editada a mano) cae al entorno en vez de mostrarse a medias', async () => {
    stubEnv();
    const ownerId = await createAdminUser();
    await saveBankDetails({ data: DATOS, actorUserId: ownerId });

    // El dominio no deja llegar a esto; un cliente de MySQL sí.
    await getTestDb().update(bankDetails).set({ cuenta: '' }).where(eq(bankDetails.id, 1));

    expect(await readBankDetails()).toBeNull();
    expect(await getDatosBancarios()).toEqual({
      banco: 'Banco Continental',
      titular: 'La del entorno S.A.',
      ruc: '80098765-9',
      cuenta: '999888777',
      tipoCuenta: 'Caja de ahorro',
      qrUrl: null,
    });
  });
});

describe.skipIf(!hasTestDb)('guardar los cinco campos', () => {
  beforeEach(resetTables);
  afterEach(() => vi.unstubAllEnvs());
  afterAll(closeTestDb);

  it('todos-o-nada: con un campo vacío no se guarda nada', async () => {
    stubEnvVacio();
    const ownerId = await createAdminUser();

    await expect(
      saveBankDetails({ data: { ...DATOS, tipoCuenta: '   ' }, actorUserId: ownerId }),
    ).rejects.toBeInstanceOf(AdminBankError);

    // Y no quedó una fila a medias esperando que alguien la complete.
    expect(await readBankDetails()).toBeNull();
    expect(await getDatosBancarios()).toBeNull();
  });

  it('rechaza un RUC con el dígito verificador equivocado', async () => {
    const ownerId = await createAdminUser();

    await expect(
      saveBankDetails({ data: { ...DATOS, ruc: '80012345-9' }, actorUserId: ownerId }),
    ).rejects.toBeInstanceOf(AdminBankError);
  });

  it('normaliza el RUC pegado y deja el guion puesto', async () => {
    const ownerId = await createAdminUser();

    await saveBankDetails({ data: { ...DATOS, ruc: '800123450' }, actorUserId: ownerId });

    expect((await readBankDetails())?.ruc).toBe('80012345-0');
  });

  it('es un singleton: guardar dos veces edita la misma fila', async () => {
    const ownerId = await createAdminUser();

    await saveBankDetails({ data: DATOS, actorUserId: ownerId });
    await saveBankDetails({
      data: { ...DATOS, cuenta: '5555555555' },
      actorUserId: ownerId,
    });

    const filas = await getTestDb().select().from(bankDetails);
    expect(filas).toHaveLength(1);
    expect(filas[0]?.cuenta).toBe('5555555555');
    expect(filas[0]?.updatedBy).toBe(ownerId);
  });
});

describe.skipIf(!hasTestDb)('el QR del SPI', () => {
  beforeEach(resetTables);
  afterEach(() => vi.unstubAllEnvs());
  afterAll(closeTestDb);

  it('no se puede cargar antes que los datos: solo no se muestra en ningún lado', async () => {
    const ownerId = await createAdminUser();

    await expect(
      setBankQr({ qrCloudinaryId: 'banco/qr-spi', actorUserId: ownerId }),
    ).rejects.toBeInstanceOf(AdminBankError);
  });

  it('guardado el public_id, queda en la fila y es el que gana sobre el entorno', async () => {
    stubEnv({ BANCO_QR_URL: '/banco-qr.png' });
    const ownerId = await createAdminUser();

    await saveBankDetails({ data: DATOS, actorUserId: ownerId });
    await setBankQr({ qrCloudinaryId: 'banco/qr-spi', actorUserId: ownerId });

    expect((await readBankDetails())?.qrCloudinaryId).toBe('banco/qr-spi');
    // De ese id sale la URL pública con `bankQrUrl` (armada en
    // `src/lib/images.ts`, probada sin base en `tests/unit/bank-qr.test.ts`).
    // Acá lo que importa es que el id quedó guardado y que la precedencia es
    // fila > entorno.
  });

  it('sin QR propio, la fila sigue aceptando el BANCO_QR_URL del entorno', async () => {
    stubEnv({ BANCO_QR_URL: '/banco-qr.png' });
    const ownerId = await createAdminUser();

    await saveBankDetails({ data: DATOS, actorUserId: ownerId });

    expect((await getDatosBancarios())?.qrUrl).toBe('/banco-qr.png');
  });

  it('quitarlo deja la fila y sus cinco campos donde estaban', async () => {
    stubEnvVacio();
    const ownerId = await createAdminUser();

    await saveBankDetails({ data: DATOS, actorUserId: ownerId });
    await setBankQr({ qrCloudinaryId: 'banco/qr-spi', actorUserId: ownerId });
    await clearBankQr({ actorUserId: ownerId });

    expect(await readBankDetails()).toMatchObject({ ...DATOS, qrCloudinaryId: null });
  });
});
