import { describe, expect, it } from 'vitest';

import { freeShippingForZone, freeShippingWithoutZone } from '../../src/domain/free-shipping';

/**
 * "Te faltan ₲X para el envío gratis".
 *
 * Las dos trampas del dato están acá: `free_threshold_pyg` es **nullable** y
 * es **por zona**. O sea que hay estados en los que no existe ningún número
 * verdadero, y el que se muestre igual es una promesa que el comercio después
 * tiene que cumplir. Cada estado tiene su test.
 */

describe('con la zona ya resuelta', () => {
  it('sin umbral no dice nada: la zona no regala el envío', () => {
    expect(freeShippingForZone({ freeThresholdPyg: null }, 900_000)).toEqual({
      kind: 'sin_umbral',
    });
  });

  it('sin zona tampoco inventa un umbral', () => {
    expect(freeShippingForZone(null, 900_000)).toEqual({ kind: 'sin_umbral' });
  });

  it('falta lo que falta, en enteros', () => {
    const progress = freeShippingForZone({ freeThresholdPyg: 500_000 }, 320_000);
    expect(progress).toEqual({ kind: 'falta', thresholdPyg: 500_000, missingPyg: 180_000 });
  });

  it('justo en el umbral ya está alcanzado, no "te falta 0"', () => {
    expect(freeShippingForZone({ freeThresholdPyg: 500_000 }, 500_000)).toEqual({
      kind: 'alcanzado',
      thresholdPyg: 500_000,
    });
  });
});

describe('sin ciudad todavía', () => {
  it('ninguna zona con umbral: silencio', () => {
    expect(
      freeShippingWithoutZone([{ freeThresholdPyg: null }, { freeThresholdPyg: null }], 100_000),
    ).toEqual({ kind: 'sin_umbral' });
  });

  it('todas las zonas con el mismo umbral: la ciudad no cambia la respuesta, se afirma', () => {
    expect(
      freeShippingWithoutZone(
        [{ freeThresholdPyg: 500_000 }, { freeThresholdPyg: 500_000 }],
        320_000,
      ),
    ).toEqual({ kind: 'falta', thresholdPyg: 500_000, missingPyg: 180_000 });
  });

  it('umbrales distintos: indefinido, con el más bajo y la aclaración', () => {
    const progress = freeShippingWithoutZone(
      [{ freeThresholdPyg: 500_000 }, { freeThresholdPyg: 800_000 }],
      320_000,
    );
    expect(progress).toEqual({
      kind: 'indefinido',
      thresholdPyg: 500_000,
      missingPyg: 180_000,
    });
  });

  it('una zona sin umbral rompe la uniformidad aunque las otras coincidan', () => {
    // Es el caso que más fácil se cuela: dos zonas con 500.000 y el interior
    // sin envío gratis. Prometer "te faltan ₲X" ahí es prometer por el
    // interior también.
    const progress = freeShippingWithoutZone(
      [{ freeThresholdPyg: 500_000 }, { freeThresholdPyg: 500_000 }, { freeThresholdPyg: null }],
      320_000,
    );
    expect(progress.kind).toBe('indefinido');
  });

  it('pasado el umbral más bajo sigue siendo indefinido, no "alcanzado"', () => {
    // Haber pasado el umbral más barato no garantiza nada en la zona que
    // termine eligiendo: la copia dice "puede que tengas", no "tenés".
    const progress = freeShippingWithoutZone(
      [{ freeThresholdPyg: 500_000 }, { freeThresholdPyg: 800_000 }],
      600_000,
    );
    expect(progress).toEqual({ kind: 'indefinido', thresholdPyg: 500_000, missingPyg: 0 });
  });

  it('sin zonas configuradas no dice nada', () => {
    expect(freeShippingWithoutZone([], 100_000)).toEqual({ kind: 'sin_umbral' });
  });
});
