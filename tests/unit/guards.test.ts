import { describe, expect, it } from 'vitest';

import { ForbiddenError, UnauthorizedError, actorLabel, requireAdmin, requireOwner } from '@/lib/session';
import { hashPassword, validatePasswordStrength, verifyPassword } from '@/lib/password';
import { formatOrderNumber, parseOrderNumber } from '@/domain/order-number';

describe('requireAdmin', () => {
  const owner = { userId: 1, email: 'due@tienda.py', role: 'owner' as const };
  const staff = { userId: 2, email: 'staff@tienda.py', role: 'staff' as const };

  it('deja pasar a owner y staff', () => {
    expect(requireAdmin(owner)).toEqual(owner);
    expect(requireAdmin(staff)).toEqual(staff);
  });

  it('rechaza sesiones vacías o a medio armar', () => {
    expect(() => requireAdmin(null)).toThrow(UnauthorizedError);
    expect(() => requireAdmin(undefined)).toThrow(UnauthorizedError);
    expect(() => requireAdmin({})).toThrow(UnauthorizedError);
    expect(() => requireAdmin({ userId: 1 })).toThrow(UnauthorizedError);
    expect(() => requireAdmin({ userId: 1, email: 'x@y.py' })).toThrow(UnauthorizedError);
  });

  it('rechaza roles desconocidos aunque la sesión esté completa', () => {
    expect(() => requireAdmin({ userId: 3, email: 'x@y.py', role: 'cliente' as never })).toThrow(ForbiddenError);
  });

  it('requireOwner excluye a staff', () => {
    expect(requireOwner(owner)).toEqual(owner);
    expect(() => requireOwner(staff)).toThrow(ForbiddenError);
  });

  it('actorLabel identifica quién movió el pedido', () => {
    expect(actorLabel(owner)).toBe('admin:due@tienda.py');
  });
});

describe('contraseñas', () => {
  it('exige largo y mezcla de letras y números', () => {
    expect(validatePasswordStrength('corta1').ok).toBe(false);
    expect(validatePasswordStrength('solamenteletras').ok).toBe(false);
    expect(validatePasswordStrength('tienda2026segura').ok).toBe(true);
  });

  it('hashea con bcrypt y verifica', async () => {
    const hash = await hashPassword('tienda2026segura');
    expect(hash.startsWith('$2')).toBe(true);
    expect(hash).not.toContain('tienda2026segura');
    expect(await verifyPassword('tienda2026segura', hash)).toBe(true);
    expect(await verifyPassword('otra-cosa', hash)).toBe(false);
  });

  it('sin hash devuelve false (usuario inexistente) sin explotar', async () => {
    expect(await verifyPassword('lo-que-sea', null)).toBe(false);
  });
});

describe('formato del número de pedido', () => {
  it('rellena a 6 dígitos con prefijo PY-', () => {
    expect(formatOrderNumber(1)).toBe('PY-000001');
    expect(formatOrderNumber(123)).toBe('PY-000123');
    expect(formatOrderNumber(1234567)).toBe('PY-1234567');
  });

  it('parsea de vuelta', () => {
    expect(parseOrderNumber('PY-000123')).toBe(123);
    expect(parseOrderNumber('py-000123')).toBe(123);
    expect(parseOrderNumber('000123')).toBeNull();
    expect(parseOrderNumber('PY-abc')).toBeNull();
  });
});
