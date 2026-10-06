import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readCode } from '../helpers/source';

/**
 * La cuenta del pedido se escribe una sola vez.
 *
 * Desde que existe una cotización pública hay dos pantallas que muestran un
 * total: la que cotiza antes de confirmar y la que cobra. Si cada una hiciera
 * la suma por su lado, alcanzaría con que una sumara el IVA del flete y la
 * otra no para que la tienda prometa un número y facture otro — y el bug
 * aparecería recién en la factura de alguien.
 *
 * Por eso las dos llaman a `computeOrderTotals`. Este control es estructural
 * (`tests/integration/shipping-quote.test.ts` compara los números de verdad):
 * lo que fija es que nadie vuelva a escribir la aritmética en el otro lado.
 */
const CREATE_ORDER = path.join('src', 'domain', 'create-order.ts');
const QUOTE_ACTION = path.join('src', 'app', 'actions', 'shipping-quote.ts');
const TOTALS = path.join('src', 'domain', 'order-totals.ts');

describe('cotizar y cobrar hacen la misma cuenta', () => {
  it('las dos entradas pasan por computeOrderTotals', async () => {
    for (const file of [CREATE_ORDER, QUOTE_ACTION]) {
      const code = await readCode(file);
      expect(code, `${file} debería usar computeOrderTotals`).toContain('computeOrderTotals(');
    }
  });

  it('ninguna de las dos rehace la aritmética por su cuenta', async () => {
    for (const file of [CREATE_ORDER, QUOTE_ACTION]) {
      const code = await readCode(file);
      // Sumar el flete o el IVA del flete afuera de `order-totals` es
      // exactamente la forma en que las dos versiones se separan.
      expect(code, `${file} no debería cotizar el envío por su cuenta`).not.toMatch(
        /quoteShipping\s*\(/,
      );
      expect(code, `${file} no debería sumar el IVA del flete por su cuenta`).not.toMatch(
        /SHIPPING_IVA_RATE/,
      );
    }
  });

  it('cobrar recalcula adentro de la transacción, con su executor', async () => {
    const code = await readCode(CREATE_ORDER);
    // Sin el executor de la transacción, el re-precio leería afuera del
    // candado y `FOR UPDATE` de las reservas dejaría de proteger nada.
    //
    // Se verifica que `executor: tx` esté entre las opciones, no que sea la
    // única: desde los cupones (PR G) también viajan el código de descuento y
    // la identidad de quien compra, y clavar la forma exacta del objeto
    // convertiría este control —que cuida el candado— en un control de estilo
    // que hay que aflojar cada vez que se agrega una opción.
    const call = code.match(/computeOrderTotals\(([\s\S]*?)\);/);
    expect(call, 'create-order.ts no llama a computeOrderTotals').not.toBeNull();
    expect(call?.[1]).toMatch(/executor:\s*tx\b/);
  });

  it('la cotización no escribe: el módulo compartido no reserva ni inserta', async () => {
    const code = await readCode(TOTALS);
    expect(code).not.toMatch(/reserveStock|\.insert\(|\.update\(/);
  });
});
