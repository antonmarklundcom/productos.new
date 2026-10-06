import { describe, expect, it } from 'vitest';

import { computeDiscount, distributeDiscount, normalizeCouponCode } from '@/domain/coupons';
import { ivaBreakdown, ivaIncluded } from '@/lib/money';

/**
 * La aritmética del descuento (PLAN.md FASE 2, PR G.2).
 *
 * Un descuento es plata, así que valen las mismas reglas que el resto del
 * camino del dinero: enteros siempre, y el IVA se sigue redondeando **por
 * línea**.
 */

describe('normalización del código', () => {
  it('sube a mayúsculas y saca espacios', () => {
    expect(normalizeCouponCode('  bienvenida 10 ')).toBe('BIENVENIDA10');
  });
});

describe('cuánto descuenta', () => {
  it('el porcentaje sale entero, redondeando a favor del comercio', () => {
    // 33% de 1.000 = 330. 33% de 1.001 = 330,33 → 330, no 331: quien paga la
    // promoción no puede perder por el redondeo.
    expect(computeDiscount({ type: 'porcentaje', value: 33 }, 1000)).toBe(330);
    expect(computeDiscount({ type: 'porcentaje', value: 33 }, 1001)).toBe(330);
  });

  it('el monto fijo es el monto', () => {
    expect(computeDiscount({ type: 'monto_fijo', value: 50_000 }, 300_000)).toBe(50_000);
  });

  it('nunca descuenta más que el subtotal', () => {
    // Un cupón de ₲100.000 sobre una compra de ₲80.000 no puede dejar el total
    // en negativo ni empezar a pagar el envío.
    expect(computeDiscount({ type: 'monto_fijo', value: 100_000 }, 80_000)).toBe(80_000);
    expect(computeDiscount({ type: 'porcentaje', value: 100 }, 80_000)).toBe(80_000);
  });

  it('sobre un carrito vacío no descuenta nada', () => {
    expect(computeDiscount({ type: 'porcentaje', value: 50 }, 0)).toBe(0);
    expect(computeDiscount({ type: 'monto_fijo', value: 50_000 }, 0)).toBe(0);
  });

  it('siempre devuelve un entero', () => {
    for (const subtotal of [1, 7, 999, 123_457, 1_000_003]) {
      for (const pct of [1, 7, 13, 33, 99]) {
        const discount = computeDiscount({ type: 'porcentaje', value: pct }, subtotal);
        expect(Number.isInteger(discount)).toBe(true);
      }
    }
  });
});

describe('el reparto entre líneas', () => {
  it('la suma de los descuentos por línea es exactamente el descuento', () => {
    // El caso que rompe un reparto ingenuo: 100 sobre tres líneas iguales no
    // se divide en enteros, y el guaraní que sobra tiene que ir a algún lado.
    const shares = distributeDiscount([1000, 1000, 1000], 100);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('reparte en proporción a lo que pesa cada línea', () => {
    const shares = distributeDiscount([9000, 1000], 1000);
    expect(shares).toEqual([900, 100]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('ninguna línea queda descontada por debajo de cero', () => {
    const lineTotals = [100, 5, 5];
    const shares = distributeDiscount(lineTotals, 110);
    shares.forEach((share, index) => {
      expect(share).toBeLessThanOrEqual(lineTotals[index]!);
      expect(share).toBeGreaterThanOrEqual(0);
    });
    expect(shares.reduce((a, b) => a + b, 0)).toBe(110);
  });

  it('sin descuento no reparte nada', () => {
    expect(distributeDiscount([1000, 2000], 0)).toEqual([0, 0]);
  });

  it('cierra para cualquier combinación de líneas y descuento', () => {
    const casos: Array<[number[], number]> = [
      [[333, 333, 334], 1],
      [[1, 1, 1, 1, 1, 1, 1], 3],
      [[123_456, 7], 1_000],
      [[10_000], 9_999],
      [[50_000, 30_000, 20_000], 33_333],
    ];

    for (const [lineTotals, discount] of casos) {
      const shares = distributeDiscount(lineTotals, discount);
      expect(shares.reduce((a, b) => a + b, 0), `${lineTotals} − ${discount}`).toBe(discount);
      shares.forEach((share) => expect(Number.isInteger(share)).toBe(true));
    }
  });
});

describe('el IVA sigue siendo por línea', () => {
  it('el desglose del carrito descontado se calcula línea por línea', () => {
    // Dos líneas con tasas distintas: el descuento tiene que bajar la base de
    // cada una y su IVA salir de esa base, no de un prorrateo sobre el total.
    const lines = [
      { lineTotalPyg: 110_000, ivaRate: 10 },
      { lineTotalPyg: 105_000, ivaRate: 5 },
    ];
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotalPyg, 0);
    const discount = 21_500; // ~10%

    const shares = distributeDiscount(
      lines.map((line) => line.lineTotalPyg),
      discount,
    );
    const descontadas = lines.map((line, index) => ({
      lineTotalPyg: line.lineTotalPyg - shares[index]!,
      ivaRate: line.ivaRate,
    }));

    const breakdown = ivaBreakdown(descontadas);

    // Cada tasa sale de su propia línea, con el mismo `ivaIncluded` de siempre.
    expect(breakdown.iva10Pyg).toBe(ivaIncluded(descontadas[0]!.lineTotalPyg, 10));
    expect(breakdown.iva5Pyg).toBe(ivaIncluded(descontadas[1]!.lineTotalPyg, 5));

    // Y la base descontada suma exactamente subtotal − descuento.
    const baseDescontada = descontadas.reduce((sum, line) => sum + line.lineTotalPyg, 0);
    expect(baseDescontada).toBe(subtotal - discount);
  });

  it('el IVA de un carrito descontado nunca supera al del carrito sin descontar', () => {
    const lines = [
      { lineTotalPyg: 110_000, ivaRate: 10 },
      { lineTotalPyg: 220_000, ivaRate: 10 },
    ];
    const sinDescuento = ivaBreakdown(lines);

    const shares = distributeDiscount(
      lines.map((line) => line.lineTotalPyg),
      33_000,
    );
    const conDescuento = ivaBreakdown(
      lines.map((line, index) => ({
        lineTotalPyg: line.lineTotalPyg - shares[index]!,
        ivaRate: line.ivaRate,
      })),
    );

    expect(conDescuento.iva10Pyg).toBeLessThan(sinDescuento.iva10Pyg);
  });
});
