import { describe, expect, it } from 'vitest';

import { reservationExpiry } from '@/domain/stock';

describe('reservationExpiry', () => {
  it.each([
    ['contra_entrega', 7 * 24 * 60],
    ['tarjeta', 45],
    ['transferencia', 24 * 60],
  ] as const)('reserva %s durante %i minutos', (method, minutes) => {
    const from = new Date('2026-03-01T12:00:00.000Z');

    expect(reservationExpiry(method, from).getTime() - from.getTime()).toBe(minutes * 60_000);
  });
});
