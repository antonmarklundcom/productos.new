import { describe, expect, it } from 'vitest';

import { sumOrderMoney } from '@/domain/order-totals';
import { ivaIncluded } from '@/lib/money';

/**
 * La aritmética del pedido, pura (O16).
 *
 * Existía inline adentro de `computeOrderTotals` y se extrajo porque ahora hay
 * dos caminos que tienen que dar exactamente el mismo resultado: el checkout,
 * que re-precia contra el catálogo, y la edición de un pedido sin pagar, que
 * conserva el precio que la compradora ya vio. Dos copias de esta cuenta se
 * separan el día que una suma el IVA del flete y la otra no.
 */

describe('sumOrderMoney', () => {
  it('total = subtotal − descuento + envío, la identidad que verifica reconcile', () => {
    const money = sumOrderMoney(
      [
        { lineTotalPyg: 300_000, ivaRate: 10 },
        { lineTotalPyg: 100_000, ivaRate: 10 },
      ],
      { discountPyg: 40_000, shippingPyg: 25_000 },
    );

    expect(money.subtotalPyg).toBe(400_000);
    expect(money.totalPyg).toBe(385_000);
    expect(money.totalPyg).toBe(money.subtotalPyg - money.discountPyg + money.shippingPyg);
  });

  it('el IVA se calcula por línea, sobre la base ya descontada', () => {
    const sinDescuento = sumOrderMoney([{ lineTotalPyg: 110_000, ivaRate: 10 }], {
      discountPyg: 0,
      shippingPyg: 0,
    });
    expect(sinDescuento.iva10Pyg).toBe(ivaIncluded(110_000, 10));

    const conDescuento = sumOrderMoney([{ lineTotalPyg: 110_000, ivaRate: 10 }], {
      discountPyg: 11_000,
      shippingPyg: 0,
    });
    // La base bajó: el IVA de esa línea también, y no se recalcula sobre el
    // total descontado (que incluiría el flete).
    expect(conDescuento.iva10Pyg).toBe(ivaIncluded(99_000, 10));
  });

  it('separa el IVA del 5 % del de 10 %, y el flete siempre va al 10 %', () => {
    const money = sumOrderMoney(
      [
        { lineTotalPyg: 100_000, ivaRate: 10 },
        { lineTotalPyg: 50_000, ivaRate: 5 },
      ],
      { discountPyg: 0, shippingPyg: 25_000 },
    );

    expect(money.iva10Pyg).toBe(ivaIncluded(100_000, 10) + ivaIncluded(25_000, 10));
    expect(money.iva5Pyg).toBe(ivaIncluded(50_000, 5));
  });

  it('el descuento repartido no pierde ni un guaraní en el redondeo', () => {
    // Tres líneas desiguales y un descuento que no divide exacto: el resto va
    // a la línea más grande (ver `distributeDiscount`).
    const money = sumOrderMoney(
      [
        { lineTotalPyg: 33_333, ivaRate: 10 },
        { lineTotalPyg: 33_333, ivaRate: 10 },
        { lineTotalPyg: 33_334, ivaRate: 10 },
      ],
      { discountPyg: 10_000, shippingPyg: 0 },
    );

    expect(money.subtotalPyg).toBe(100_000);
    expect(money.totalPyg).toBe(90_000);
  });

  it('un descuento que se lleva todo el subtotal deja el envío, nunca un negativo', () => {
    // El tope lo pone `computeDiscount` aguas arriba —un cupón de ₲100.000
    // sobre una compra de ₲80.000 descuenta ₲80.000— y esta función hace la
    // cuenta honesta con lo que le dan. El caso importa porque el envío
    // **no** se descuenta nunca: el cupón baja la mercadería, no el flete.
    const money = sumOrderMoney([{ lineTotalPyg: 80_000, ivaRate: 10 }], {
      discountPyg: 80_000,
      shippingPyg: 25_000,
    });

    expect(money.totalPyg).toBe(25_000);
    // Sin base gravada de mercadería, el único IVA que queda es el del flete.
    expect(money.iva10Pyg).toBe(ivaIncluded(25_000, 10));
  });

  it('no inventa centavos: todo lo que devuelve es entero', () => {
    const money = sumOrderMoney(
      [
        { lineTotalPyg: 33_333, ivaRate: 10 },
        { lineTotalPyg: 66_667, ivaRate: 5 },
      ],
      { discountPyg: 7_777, shippingPyg: 13_333 },
    );

    for (const valor of Object.values(money)) {
      expect(Number.isInteger(valor)).toBe(true);
    }
  });
});
