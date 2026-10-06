import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { shippingZones } from '@/db/schema';
import {
  AdminShippingError,
  createShippingZone,
  listAdminShippingZones,
  moveShippingZone,
  parseCityList,
  setShippingZoneActive,
  updateShippingZone,
} from '@/domain/admin-shipping';
import { quoteShipping } from '@/domain/shipping';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';

/**
 * ABM de zonas de envío (PLAN.md FASE 2, PR K).
 *
 * Casi todo lo que se prueba acá es plata perdida en silencio: una ciudad en
 * dos zonas cobra el flete que le toque por orden de filas, y una tienda sin
 * zonas activas regala el envío a todo el país sin que ninguna pantalla lo
 * diga. Ninguno de los dos rompe nada, y por eso hacen falta tests.
 */

const ASUNCION = {
  name: 'Gran Asunción',
  cities: ['Asunción', 'Lambaré', 'Fernando de la Mora'],
  pricePyg: 25_000,
  freeThresholdPyg: 300_000,
};

const INTERIOR = {
  name: 'Interior',
  cities: [],
  pricePyg: 60_000,
  freeThresholdPyg: null,
};

describe.skipIf(!hasTestDb)('alta y validación de zonas', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('crea con slug derivado del nombre y ciudades limpias', async () => {
    const zona = await createShippingZone({
      ...ASUNCION,
      cities: ['  Asunción  ', 'LAMBARÉ', 'lambare', ''],
    });

    expect(zona.slug).toBe('gran-asuncion');
    // "LAMBARÉ" y "lambare" son la misma ciudad: se compara normalizado y se
    // guarda la primera forma que escribió el dueño.
    expect(zona.cities).toEqual(['Asunción', 'LAMBARÉ']);
    expect(zona.isActive).toBe(true);
  });

  it('rechaza un precio con decimales', async () => {
    await expect(
      createShippingZone({ ...ASUNCION, pricePyg: 25_000.5 }),
    ).rejects.toThrow(AdminShippingError);
  });

  it('rechaza un umbral de gratis en cero', async () => {
    await expect(
      createShippingZone({ ...ASUNCION, freeThresholdPyg: 0 }),
    ).rejects.toThrow(AdminShippingError);
  });

  it('acepta una zona sin ciudades: es el comodín del interior', async () => {
    const zona = await createShippingZone(INTERIOR);
    expect(zona.cities).toEqual([]);
  });

  it('no deja dos zonas con el mismo identificador', async () => {
    await createShippingZone(ASUNCION);
    await expect(createShippingZone(ASUNCION)).rejects.toThrow(AdminShippingError);
  });

  it('no deja la misma ciudad en dos zonas, y dice en cuál está', async () => {
    await createShippingZone(ASUNCION);

    await expect(
      createShippingZone({
        name: 'Central',
        cities: ['luque', 'LAMBARE'],
        pricePyg: 30_000,
        freeThresholdPyg: null,
      }),
    ).rejects.toThrow(/Gran Asunción/);
  });

  it('editar una zona puede conservar sus propias ciudades', async () => {
    const zona = await createShippingZone(ASUNCION);

    // El chequeo de unicidad se excluye a sí misma: sin eso, guardar sin tocar
    // las ciudades daría "Asunción ya está en Gran Asunción".
    await updateShippingZone({
      zoneId: zona.id,
      data: { ...ASUNCION, pricePyg: 28_000 },
    });

    const [row] = await listAdminShippingZones();
    expect(row?.pricePyg).toBe(28_000);
    expect(row?.cities).toHaveLength(3);
  });
});

describe.skipIf(!hasTestDb)('lo que cotiza el checkout', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('cobra la zona exacta y respeta el umbral de gratis', async () => {
    await createShippingZone(ASUNCION);
    await createShippingZone(INTERIOR);

    const barato = await quoteShipping('lambare', 100_000);
    expect(barato.match).toBe('exacta');
    expect(barato.shippingPyg).toBe(25_000);

    const gratis = await quoteShipping('Asunción', 300_000);
    expect(gratis.isFree).toBe(true);
    expect(gratis.shippingPyg).toBe(0);
  });

  it('una ciudad que no está en ninguna lista cae en la más cara', async () => {
    await createShippingZone(ASUNCION);
    await createShippingZone(INTERIOR);

    const cotizacion = await quoteShipping('Encarnación', 100_000);
    expect(cotizacion.match).toBe('mas_cara');
    expect(cotizacion.zoneName).toBe('Interior');
    expect(cotizacion.shippingPyg).toBe(60_000);
  });

  it('subir el precio no toca lo ya cotizado, sí lo próximo', async () => {
    const zona = await createShippingZone(ASUNCION);
    expect((await quoteShipping('Asunción', 100_000)).shippingPyg).toBe(25_000);

    await updateShippingZone({ zoneId: zona.id, data: { ...ASUNCION, pricePyg: 35_000 } });
    expect((await quoteShipping('Asunción', 100_000)).shippingPyg).toBe(35_000);
  });

  it('una zona desactivada deja de cotizarse', async () => {
    const asuncion = await createShippingZone(ASUNCION);
    await createShippingZone(INTERIOR);

    await setShippingZoneActive({ zoneId: asuncion.id, isActive: false });

    const cotizacion = await quoteShipping('Asunción', 100_000);
    expect(cotizacion.zoneName).toBe('Interior');
  });
});

describe.skipIf(!hasTestDb)('la última zona activa no se puede apagar', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('con dos, apagar una anda', async () => {
    const asuncion = await createShippingZone(ASUNCION);
    await createShippingZone(INTERIOR);

    await expect(
      setShippingZoneActive({ zoneId: asuncion.id, isActive: false }),
    ).resolves.toBeUndefined();
  });

  it('con una sola, se rechaza y la tienda sigue cobrando flete', async () => {
    const zona = await createShippingZone(ASUNCION);

    await expect(setShippingZoneActive({ zoneId: zona.id, isActive: false })).rejects.toThrow(
      AdminShippingError,
    );

    // Lo que se estaba evitando: `sin_zonas` es envío ₲0 para todo el país.
    const cotizacion = await quoteShipping('Asunción', 100_000);
    expect(cotizacion.match).not.toBe('sin_zonas');
    expect(cotizacion.shippingPyg).toBe(25_000);
  });

  it('apagar la última de a dos, una tras otra, también se frena', async () => {
    const asuncion = await createShippingZone(ASUNCION);
    const interior = await createShippingZone(INTERIOR);

    await setShippingZoneActive({ zoneId: asuncion.id, isActive: false });
    await expect(
      setShippingZoneActive({ zoneId: interior.id, isActive: false }),
    ).rejects.toThrow(AdminShippingError);
  });

  it('reactivar siempre se puede', async () => {
    const asuncion = await createShippingZone(ASUNCION);
    await createShippingZone(INTERIOR);
    await setShippingZoneActive({ zoneId: asuncion.id, isActive: false });

    await setShippingZoneActive({ zoneId: asuncion.id, isActive: true });
    const filas = await listAdminShippingZones();
    expect(filas.every((row) => row.isActive)).toBe(true);
  });
});

describe.skipIf(!hasTestDb)('orden de las zonas', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('renumera aunque las posiciones vengan repetidas', async () => {
    const a = await createShippingZone({ ...ASUNCION, name: 'Zona uno', cities: ['Asunción'] });
    const b = await createShippingZone({ ...ASUNCION, name: 'Zona dos', cities: ['Luque'] });
    const c = await createShippingZone({ ...ASUNCION, name: 'Zona tres', cities: ['Capiatá'] });

    const db = getTestDb();
    for (const zona of [a, b, c]) {
      await db.update(shippingZones).set({ position: 0 }).where(eq(shippingZones.id, zona.id));
    }

    await moveShippingZone({ zoneId: c.id, direction: 'up' });

    const filas = await listAdminShippingZones();
    expect(filas.map((row) => row.position)).toEqual([0, 1, 2]);
    expect(filas.map((row) => row.name)).toEqual(['Zona uno', 'Zona tres', 'Zona dos']);
  });
});

describe('parseCityList', () => {
  it('acepta líneas, comas y las dos mezcladas', () => {
    expect(parseCityList('Asunción\nLambaré, Luque;  Capiatá  \n\n')).toEqual([
      'Asunción',
      'Lambaré',
      'Luque',
      'Capiatá',
    ]);
  });

  it('un textarea vacío es una lista vacía, no [""]', () => {
    expect(parseCityList('   \n  ')).toEqual([]);
  });
});
