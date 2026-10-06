import { describe, expect, it } from 'vitest';

import { ORDER_STATUSES, type OrderStatus } from '@/db/schema';
import { ORDER_TRANSITIONS, canTransition } from '@/domain/orders';

/** La tabla de aristas es la especificación; estos tests la fijan. */
describe('ORDER_TRANSITIONS', () => {
  it('cubre todos los estados del ENUM', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it('no apunta a estados inexistentes', () => {
    for (const targets of Object.values(ORDER_TRANSITIONS)) {
      for (const target of targets) {
        expect(ORDER_STATUSES).toContain(target);
      }
    }
  });

  it('nadie puede volver a pendiente_pago', () => {
    const sources = ORDER_STATUSES.filter((status) => canTransition(status, 'pendiente_pago'));
    expect(sources).toEqual([]);
  });

  it('rechazado permite reintentar el comprobante, cobrar, vencer o cancelar', () => {
    expect(canTransition('rechazado', 'esperando_verificacion')).toBe(true);
    expect(canTransition('rechazado', 'pagado')).toBe(true);
    expect(ORDER_TRANSITIONS.rechazado).toEqual([
      'esperando_verificacion', 'pagado', 'vencido', 'cancelado',
    ]);
  });

  it('un pedido enviado no puede volver a pagado (webhook tardío o repetido)', () => {
    expect(canTransition('enviado', 'pagado')).toBe(false);
    expect(canTransition('entregado', 'pagado')).toBe(false);
    expect(canTransition('preparando', 'pagado')).toBe(false);
  });

  it('sólo se cancela antes de que entre la plata', () => {
    const cancelables = ORDER_STATUSES.filter((status) => canTransition(status, 'cancelado'));
    expect(cancelables.sort()).toEqual(
      (['pendiente_pago', 'esperando_verificacion', 'rechazado', 'vencido'] satisfies OrderStatus[]).sort(),
    );
  });

  it('sólo se reembolsa después de cobrar', () => {
    const refundables = ORDER_STATUSES.filter((status) => canTransition(status, 'reembolsado'));
    expect(refundables.sort()).toEqual((['pagado', 'preparando', 'enviado', 'entregado'] satisfies OrderStatus[]).sort());
  });

  it('cancelado y reembolsado son terminales; entregado sólo permite reembolsar', () => {
    expect(ORDER_TRANSITIONS.entregado).toEqual(['reembolsado']);
    expect(ORDER_TRANSITIONS.cancelado).toEqual([]);
    expect(ORDER_TRANSITIONS.reembolsado).toEqual([]);
  });

  it('ningún estado se transiciona a sí mismo (eso es un no-op, no una arista)', () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('el camino feliz completo está permitido', () => {
    const happyPath: OrderStatus[] = [
      'pendiente_pago',
      'esperando_verificacion',
      'pagado',
      'preparando',
      'enviado',
      'entregado',
    ];
    for (let i = 0; i < happyPath.length - 1; i += 1) {
      const from = happyPath[i]!;
      const to = happyPath[i + 1]!;
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
    }
  });
});
