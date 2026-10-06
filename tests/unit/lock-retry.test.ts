import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isLockConflict,
  LOCK_RETRY_ATTEMPTS,
  withLockRetry,
} from '../../src/db/retry';

/**
 * Reintento por conflicto de locks (`src/db/retry.ts`).
 *
 * Salió de un test que fallaba una de cada diez corridas: `reserveStock` y la
 * aplicación de un pago se trababan, MySQL mataba a la reserva, y el comprador
 * recibía el error crudo de la base en vez del "sin stock" que el código
 * quería darle.
 *
 * Lo delicado del reintento no es reintentar: es **no** reintentar de más. Un
 * `InsufficientStockError` es una respuesta correcta, y volver a correr la
 * transacción porque "falló" sería cobrar dos veces la misma pelea.
 */

function errorDeDrizzle(code: string): Error {
  // Como llega de verdad: drizzle envuelve lo de mysql2 y el código queda una
  // capa más abajo, en `cause`.
  return new Error('Failed query: select `qty` from `stock_reservations`', {
    cause: Object.assign(new Error('Deadlock found when trying to get lock'), { code }),
  });
}

describe('isLockConflict', () => {
  it('reconoce el deadlock y el lock wait timeout, por código y por número', () => {
    expect(isLockConflict(Object.assign(new Error('x'), { code: 'ER_LOCK_DEADLOCK' }))).toBe(true);
    expect(isLockConflict(Object.assign(new Error('x'), { code: 'ER_LOCK_WAIT_TIMEOUT' }))).toBe(
      true,
    );
    expect(isLockConflict(Object.assign(new Error('x'), { errno: 1213 }))).toBe(true);
    expect(isLockConflict(Object.assign(new Error('x'), { errno: 1205 }))).toBe(true);
  });

  it('lo encuentra abajo del envoltorio de drizzle', () => {
    // Éste es el caso real: sin mirar `cause`, el reintento nunca se dispara y
    // el arreglo no arregla nada.
    expect(isLockConflict(errorDeDrizzle('ER_LOCK_DEADLOCK'))).toBe(true);
  });

  it('no confunde otros errores de la base con un conflicto de locks', () => {
    // Reintentar un Access denied o una tabla que no existe es tres veces el
    // mismo error y tres veces la espera.
    for (const code of ['ER_ACCESS_DENIED_ERROR', 'ER_NO_SUCH_TABLE', 'ECONNREFUSED']) {
      expect(isLockConflict(errorDeDrizzle(code)), code).toBe(false);
    }
    expect(isLockConflict(new Error('cualquier cosa'))).toBe(false);
    expect(isLockConflict(null)).toBe(false);
    expect(isLockConflict('un string')).toBe(false);
  });

  it('una cadena de causes circular no lo cuelga', () => {
    const a = Object.assign(new Error('a'), { cause: undefined as unknown });
    a.cause = a;
    expect(isLockConflict(a)).toBe(false);
  });
});

describe('withLockRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lo que sale bien a la primera corre una sola vez', async () => {
    const run = vi.fn().mockResolvedValue({ reserved: 1 });

    await expect(withLockRetry(run)).resolves.toEqual({ reserved: 1 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reintenta el conflicto de locks y devuelve el resultado bueno', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = vi
      .fn()
      .mockRejectedValueOnce(errorDeDrizzle('ER_LOCK_DEADLOCK'))
      .mockResolvedValue({ reserved: 1 });

    await expect(withLockRetry(run)).resolves.toEqual({ reserved: 1 });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('NO reintenta un error de negocio', async () => {
    // Lo más importante del archivo: un "no hay stock" es una respuesta, no una
    // falla. Reintentarlo sería volver a pelear una pelea ya perdida —y, si
    // alguna vez la transacción tuviera efectos parciales, duplicarlos.
    class SinStock extends Error {}
    const run = vi.fn().mockRejectedValue(new SinStock('no hay stock'));

    await expect(withLockRetry(run)).rejects.toBeInstanceOf(SinStock);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('se rinde después de los intentos y tira el último error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = vi.fn().mockRejectedValue(errorDeDrizzle('ER_LOCK_DEADLOCK'));

    // Reintentar para siempre convierte un choque en una request colgada.
    await expect(withLockRetry(run)).rejects.toThrow(/Failed query/);
    expect(run).toHaveBeenCalledTimes(LOCK_RETRY_ATTEMPTS);
  });

  it('el log no lleva el detalle de la query', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = vi
      .fn()
      .mockRejectedValueOnce(errorDeDrizzle('ER_LOCK_DEADLOCK'))
      .mockResolvedValue(null);

    await withLockRetry(run);

    const logueado = warn.mock.calls.flat().join(' ');
    expect(logueado).toContain('reintento');
    expect(logueado).not.toContain('stock_reservations');
  });
});
