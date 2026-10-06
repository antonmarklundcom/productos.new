import { describe, expect, it } from 'vitest';

import {
  formatDatePY,
  formatDateTimePY,
  parsePyDateInput,
  parsePyDateInputEnd,
  startOfDayPY,
  startOfMonthPY,
  startOfNextDayPY,
} from '../../src/lib/py';

describe('formatDatePY / formatDateTimePY', () => {
  it('formatea en dd/mm/yyyy', () => {
    expect(formatDatePY(new Date('2026-08-07T15:00:00Z'))).toBe('07/08/2026');
    expect(formatDatePY(new Date('2026-01-05T15:00:00Z'))).toBe('05/01/2026');
  });

  it('formatea con hora en dd/mm/yyyy HH:mm, 24 horas', () => {
    // 2026-08-07 15:00 UTC = 12:00 en Asunción (UTC−3).
    expect(formatDateTimePY(new Date('2026-08-07T15:00:00Z'))).toBe('07/08/2026 12:00');
  });

  it('una fecha tarde en UTC cae en el día paraguayo correcto', () => {
    // 2026-08-07 23:30 UTC = 2026-08-07 20:30 en Asunción: mismo día.
    expect(formatDatePY(new Date('2026-08-07T23:30:00Z'))).toBe('07/08/2026');

    // 2026-08-08 02:30 UTC = 2026-08-07 23:30 en Asunción: todavía el día anterior.
    expect(formatDatePY(new Date('2026-08-08T02:30:00Z'))).toBe('07/08/2026');

    // 2026-08-08 03:00 UTC = 2026-08-08 00:00 en Asunción: ya cruzó al día siguiente.
    expect(formatDatePY(new Date('2026-08-08T03:00:00Z'))).toBe('08/08/2026');
  });

  it('cruza el año correctamente cerca de medianoche', () => {
    // 2027-01-01 01:00 UTC = 2026-12-31 22:00 en Asunción.
    expect(formatDatePY(new Date('2027-01-01T01:00:00Z'))).toBe('31/12/2026');
  });
});

/**
 * Los cortes de día en hora paraguaya (PLAN.md 4.7).
 *
 * Todo se guarda en UTC, pero "las ventas de hoy" es una pregunta en hora de
 * Asunción. Entre las 21:00 y la medianoche de Asunción ya es el día
 * siguiente en UTC: con el corte mal puesto, el panel muestra el día
 * equivocado todas las noches — justo cuando el dueño cierra la caja.
 */
describe('cortes de día en America/Asuncion', () => {
  it('las 21:00 de Asunción siguen siendo el mismo día, aunque en UTC ya sea el siguiente', () => {
    // 2026-08-07 21:30 en Asunción (UTC−3) = 2026-08-08 00:30 UTC.
    const instant = new Date('2026-08-08T00:30:00Z');

    // El día paraguayo arrancó a las 03:00Z del 7.
    expect(startOfDayPY(instant).toISOString()).toBe('2026-08-07T03:00:00.000Z');
    expect(startOfNextDayPY(instant).toISOString()).toBe('2026-08-08T03:00:00.000Z');
  });

  it('la medianoche paraguaya es el primer instante del día', () => {
    const medianoche = new Date('2026-08-07T03:00:00Z');
    expect(startOfDayPY(medianoche).toISOString()).toBe('2026-08-07T03:00:00.000Z');

    // Un segundo antes todavía es el día anterior.
    const unSegundoAntes = new Date('2026-08-07T02:59:59Z');
    expect(startOfDayPY(unSegundoAntes).toISOString()).toBe('2026-08-06T03:00:00.000Z');
  });

  it('el mes arranca en la medianoche paraguaya del día 1', () => {
    const instant = new Date('2026-08-20T18:00:00Z');
    expect(startOfMonthPY(instant).toISOString()).toBe('2026-08-01T03:00:00.000Z');
  });

  it('el primer día del mes, el corte de mes y el de día coinciden', () => {
    const instant = new Date('2026-08-01T15:00:00Z');
    expect(startOfMonthPY(instant).getTime()).toBe(startOfDayPY(instant).getTime());
  });

  it('funciona cruzando el año', () => {
    // 2026-12-31 22:00 en Asunción = 2027-01-01 01:00 UTC.
    const instant = new Date('2027-01-01T01:00:00Z');
    expect(startOfDayPY(instant).toISOString()).toBe('2026-12-31T03:00:00.000Z');
    expect(startOfMonthPY(instant).toISOString()).toBe('2026-12-01T03:00:00.000Z');
  });

  it('el inicio del día siguiente es exactamente 24 h después (sin horario de verano)', () => {
    const instant = new Date('2026-08-07T12:00:00Z');
    const diff = startOfNextDayPY(instant).getTime() - startOfDayPY(instant).getTime();
    expect(diff).toBe(24 * 3600_000);
  });
});

describe('parseo de los filtros de fecha', () => {
  it('convierte lo que manda un <input type="date"> a la medianoche paraguaya', () => {
    expect(parsePyDateInput('2026-08-07')?.toISOString()).toBe('2026-08-07T03:00:00.000Z');
  });

  it('el borde superior es exclusivo: incluye todo el día pedido', () => {
    const fin = parsePyDateInputEnd('2026-08-07');
    expect(fin?.toISOString()).toBe('2026-08-08T03:00:00.000Z');

    // Las 23:59 del 7 en Asunción caen adentro del rango…
    expect(new Date('2026-08-08T02:59:00Z').getTime()).toBeLessThan(fin!.getTime());
    // …y las 00:00 del 8, afuera.
    expect(new Date('2026-08-08T03:00:00Z').getTime()).toBeGreaterThanOrEqual(fin!.getTime());
  });

  it('devuelve null para basura, en vez de una fecha inventada', () => {
    for (const value of ['', '7/8/2026', '2026-8-7', 'ayer', '2026-13-01', '2026-08-32', null, undefined]) {
      expect(parsePyDateInput(value), `valor: ${String(value)}`).toBeNull();
    }
  });
});
