import { describe, expect, it } from 'vitest';

import {
  CONSUMIDOR_FINAL_RUC,
  PhoneError,
  formatPhonePY,
  formatRuc,
  isConsumidorFinalRuc,
  isMobilePY,
  normalizePhonePY,
  rucCheckDigit,
  rucFromCi,
  validateCi,
  validateDoc,
  validateRuc,
  waLink,
} from '@/lib/py';

describe('rucCheckDigit / validateRuc', () => {
  it('calcula el DV módulo 11', () => {
    // 5·2+4·3+3·4+2·5+1·6+0·7+0·8+8·9 = 122; 122 % 11 = 1 ≤ 1 ⇒ DV = 0.
    expect(rucCheckDigit('80012345')).toBe(0);
    expect(formatRuc('80012345')).toBe('80012345-0');
    // 44444401 → total 158; 158 % 11 = 4 ⇒ DV = 11 − 4 = 7 (consumidor final).
    expect(rucCheckDigit('44444401')).toBe(7);
  });

  it('valida el RUC de consumidor final 44444401-7', () => {
    expect(validateRuc(CONSUMIDOR_FINAL_RUC)).toEqual({ ok: true, normalized: '44444401-7' });
    expect(isConsumidorFinalRuc('44444401-7')).toBe(true);
    expect(isConsumidorFinalRuc('44444401')).toBe(false); // sin DV no es ese RUC
  });

  it('acepta el RUC con o sin guion y con espacios', () => {
    expect(validateRuc('80012345-0').ok).toBe(true);
    expect(validateRuc('800123450').ok).toBe(true);
    expect(validateRuc(' 80012345-0 ').ok).toBe(true);
    expect(validateRuc('800123450').normalized).toBe('80012345-0');
  });

  it('rechaza un DV incorrecto', () => {
    // El DV real de 80012345 es 0, no 6 (el ejemplo de ARCH.md no valida).
    const result = validateRuc('80012345-6');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/verificador/);
  });

  it('rechaza basura', () => {
    expect(validateRuc('').ok).toBe(false);
    expect(validateRuc('abc-1').ok).toBe(false);
    expect(validateRuc('1').ok).toBe(false);
  });

  it('el DV de una CI arma el RUC de persona física', () => {
    expect(rucFromCi('1234567')).toBe(`1234567-${rucCheckDigit('1234567')}`);
    expect(validateRuc(rucFromCi('1234567')).ok).toBe(true);
  });
});

describe('validateCi', () => {
  it('acepta 5 a 8 dígitos, con o sin puntos', () => {
    expect(validateCi('1234567')).toEqual({ ok: true, normalized: '1234567' });
    expect(validateCi('1.234.567')).toEqual({ ok: true, normalized: '1234567' });
  });

  it('rechaza longitudes fuera de rango', () => {
    expect(validateCi('123').ok).toBe(false);
    expect(validateCi('123456789').ok).toBe(false);
  });
});

describe('validateDoc', () => {
  it('NINGUNO no requiere número', () => {
    expect(validateDoc('NINGUNO', null)).toEqual({ ok: true, normalized: null });
  });

  it('RUC y CI usan su propia validación', () => {
    expect(validateDoc('RUC', '80012345-0').ok).toBe(true);
    expect(validateDoc('RUC', '80012345-6').ok).toBe(false);
    expect(validateDoc('CI', '1234567').ok).toBe(true);
    expect(validateDoc('CI', undefined).ok).toBe(false);
  });
});

describe('normalizePhonePY', () => {
  it('normaliza a E.164', () => {
    expect(normalizePhonePY('0981 123 456')).toBe('+595981123456');
    expect(normalizePhonePY('0981123456')).toBe('+595981123456');
    expect(normalizePhonePY('981123456')).toBe('+595981123456');
    expect(normalizePhonePY('+595 981 123-456')).toBe('+595981123456');
    expect(normalizePhonePY('595981123456')).toBe('+595981123456');
    expect(normalizePhonePY('00595981123456')).toBe('+595981123456');
    expect(normalizePhonePY('(0981) 123-456')).toBe('+595981123456');
  });

  it('normaliza fijos de Asunción', () => {
    expect(normalizePhonePY('021 123 456')).toBe('+59521123456');
  });

  it('devuelve null si no es un número paraguayo plausible', () => {
    expect(normalizePhonePY('123')).toBeNull();
    expect(normalizePhonePY('')).toBeNull();
    expect(normalizePhonePY('abc')).toBeNull();
    expect(normalizePhonePY('+5491112345678')).toBeNull();
  });

  it('distingue móvil de fijo', () => {
    expect(isMobilePY('0981123456')).toBe(true);
    expect(isMobilePY('021123456')).toBe(false);
  });

  it('formatea para mostrar', () => {
    expect(formatPhonePY('+595981123456')).toBe('(0981) 123-456');
  });
});

describe('waLink', () => {
  it('arma el deeplink sin el "+"', () => {
    expect(waLink('0981123456')).toBe('https://wa.me/595981123456');
  });

  it('codifica el texto', () => {
    const link = waLink('0981123456', 'Hola! Pedido PY-000123 por ₲ 150.000');
    expect(link.startsWith('https://wa.me/595981123456?text=')).toBe(true);
    expect(link).toContain('PY-000123');
    expect(link).not.toContain(' ');
    expect(decodeURIComponent(link.split('?text=')[1] ?? '')).toBe(
      'Hola! Pedido PY-000123 por ₲ 150.000',
    );
  });

  it('recorta los textos largos (los deeplinks se truncan en iOS)', () => {
    const link = waLink('0981123456', 'a'.repeat(5000));
    const text = decodeURIComponent(link.split('?text=')[1] ?? '');
    expect(text).toHaveLength(1500);
    expect(text.endsWith('…')).toBe(true);
  });

  it('explota con un número inválido en vez de generar un link roto', () => {
    expect(() => waLink('123', 'hola')).toThrow(PhoneError);
  });
});
