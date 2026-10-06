import { describe, expect, it } from 'vitest';

import { MoneyError, assertGs, formatGs, formatGsPlain, ivaBreakdown, ivaIncluded, lineTotal } from '@/lib/money';

describe('formatGs', () => {
  it('formatea con separador de miles paraguayo', () => {
    expect(formatGs(1234567)).toBe('₲ 1.234.567');
    expect(formatGs(0)).toBe('₲ 0');
    expect(formatGs(150000)).toBe('₲ 150.000');
    expect(formatGs(1000)).toBe('₲ 1.000');
  });

  it('formatea negativos con el signo antes del símbolo', () => {
    expect(formatGs(-25000)).toBe('-₲ 25.000');
  });

  it('rechaza cualquier cosa que no sea un entero', () => {
    expect(() => formatGs(1234.5)).toThrow(MoneyError);
    expect(() => formatGs(Number.NaN)).toThrow(MoneyError);
  });

  it('formatGsPlain no lleva símbolo (para inputs y copiar)', () => {
    expect(formatGsPlain(150000)).toBe('150.000');
  });
});

describe('assertGs', () => {
  it('deja pasar enteros seguros', () => {
    expect(assertGs(999999999)).toBe(999999999);
  });

  it('explota con floats — un céntimo no existe en guaraníes', () => {
    expect(() => assertGs(1000.01, 'total')).toThrow(/entero en guaraníes/);
  });
});

describe('ivaIncluded', () => {
  it('desglosa el IVA que ya viene adentro del precio', () => {
    expect(ivaIncluded(110000, 10)).toBe(10000);
    expect(ivaIncluded(105000, 5)).toBe(5000);
    expect(ivaIncluded(95000, 0)).toBe(0);
  });

  it('redondea por línea, no sobre el total', () => {
    // 3 líneas de 33.333: por línea 3.030 c/u = 9.090.
    // Sobre el total (99.999) daría 9.091 — 1 guaraní de diferencia contra la factura.
    const perLine = 3 * ivaIncluded(33333, 10);
    const onTotal = ivaIncluded(99999, 10);
    expect(perLine).toBe(9090);
    expect(onTotal).toBe(9091);
    expect(perLine).not.toBe(onTotal);
  });

  it('devuelve enteros siempre', () => {
    for (const value of [1, 7, 999, 12345, 987654321]) {
      expect(Number.isInteger(ivaIncluded(value, 10))).toBe(true);
      expect(Number.isInteger(ivaIncluded(value, 5))).toBe(true);
    }
  });

  it('rechaza tasas que no existen en PY', () => {
    expect(() => ivaIncluded(100000, 21)).toThrow(/iva_rate inválida/);
  });
});

describe('ivaBreakdown', () => {
  it('suma por tasa, línea por línea', () => {
    const result = ivaBreakdown([
      { lineTotalPyg: 110000, ivaRate: 10 },
      { lineTotalPyg: 220000, ivaRate: 10 },
      { lineTotalPyg: 105000, ivaRate: 5 },
      { lineTotalPyg: 95000, ivaRate: 0 },
    ]);
    expect(result).toEqual({ iva10Pyg: 30000, iva5Pyg: 5000 });
  });
});

describe('lineTotal', () => {
  it('multiplica precio unitario por cantidad', () => {
    expect(lineTotal(110000, 3)).toBe(330000);
  });

  it('rechaza cantidades inválidas', () => {
    expect(() => lineTotal(110000, 0)).toThrow(MoneyError);
    expect(() => lineTotal(110000, 1.5)).toThrow(MoneyError);
  });
});
