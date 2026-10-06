import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listSourceFiles, readCode } from '../helpers/source';

/**
 * Guardarraíl del PR #1: `orders.status` sólo se escribe adentro de
 * `transitionOrder()`. Este test es el grep de la Definition of Done corriendo
 * en CI, para que la regla no se pierda cuando el código crezca.
 */
const ROOTS = ['src', 'scripts', 'tests'];
const TRANSITION_ORDER_MODULE = path.join('src', 'domain', 'orders.ts');
/** Este mismo archivo nombra el patrón que busca; no se escanea a sí mismo. */
const SELF = path.join('tests', 'unit', 'no-raw-status-update.test.ts');

describe('orders.status sólo se escribe vía transitionOrder()', () => {
  it('no hay ningún `UPDATE orders SET status` crudo', async () => {
    const offenders: string[] = [];
    for (const file of await listSourceFiles(ROOTS)) {
      if (file === SELF) continue;
      const code = await readCode(file);
      if (/update\s+orders\s+set\s+status/i.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('ningún módulo fuera de domain/orders.ts escribe el campo status del pedido', async () => {
    const offenders: string[] = [];
    for (const file of await listSourceFiles(ROOTS)) {
      if (file === TRANSITION_ORDER_MODULE || file === SELF) continue;
      const code = await readCode(file);
      // .update(orders).set({ ... status: ... })
      //
      // El `.set(` va pegado al `.update(orders)` a propósito: buscar
      // "cualquier `status:` en los 200 caracteres siguientes" marcaba como
      // culpable a un `.update(orders).set({ createdAt })` que apenas tenía
      // cerca, en otra función, un `createOrder({ status: ... })`. Un
      // guardarraíl que grita en falso es un guardarraíl que alguien termina
      // borrando.
      if (/\.update\(\s*orders\s*\)\s*\.set\(\s*\{[\s\S]{0,200}?\bstatus\s*:/.test(code)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
