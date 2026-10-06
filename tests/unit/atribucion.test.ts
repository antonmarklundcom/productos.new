import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { exportedAsyncFunctions, listSourceFiles, readCode } from '../helpers/source';

/**
 * Guardarraíl del PR D: lo que hace una persona del panel queda atribuido.
 *
 * La columna sirve para una pregunta muy concreta del dueño —"¿qué hizo X
 * hoy?", que en el chat 2 se convierte en `/admin/actividad`— y esa pantalla
 * sólo es tan buena como la disciplina de completar la FK. Una acción nueva
 * que escriba un evento sin `actorUserId` no rompe nada visible: simplemente
 * deja un agujero en el historial que nadie nota hasta que lo necesita.
 *
 * Por eso se verifica sobre el código: toda acción de admin que dispare una
 * escritura auditada tiene que pasar el id que ya tiene en la mano.
 */

const ACTIONS_DIR = path.join('src', 'app', 'actions');

/**
 * Lo que deja fila en una tabla de auditoría: `order_events`,
 * `stock_adjustments`, `order_notes` (O5), `refunds` y `price_adjustments`
 * (O7). Agregar una escritura auditada sin agregarla acá deja el control
 * pasando en falso, que es peor que no tenerlo.
 */
const ESCRITURAS_AUDITADAS =
  /transitionOrder\s*\(|adjustStock\s*\(|retryOrderRevival\s*\(|refundPayment\s*\(|reviewReceipt\s*\(|addOrderNoteToDomain\s*\(|bulkAdjustPrices\s*\(|editPendingOrder\s*\(/;

/** Cómo se pasa la atribución: la FK directa, o el `reviewerId` que ya lo es. */
const ATRIBUCION = /actorUserId|reviewerId/;

describe('atribución de lo que hace el panel', () => {
  it('toda acción de admin que escribe auditoría pasa el id del actor', async () => {
    const files = (await listSourceFiles([ACTIONS_DIR])).filter(
      (file) => path.basename(file).startsWith('admin-'),
    );
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const code = await readCode(file);
      for (const action of exportedAsyncFunctions(code)) {
        if (!ESCRITURAS_AUDITADAS.test(action.body)) continue;
        if (!ATRIBUCION.test(action.body)) {
          offenders.push(`${file} → ${action.name}()`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('el test no se quedó sin objetivo: hay acciones que escriben auditoría', async () => {
    const files = (await listSourceFiles([ACTIONS_DIR])).filter(
      (file) => path.basename(file).startsWith('admin-'),
    );

    let conEscritura = 0;
    for (const file of files) {
      for (const action of exportedAsyncFunctions(await readCode(file))) {
        if (ESCRITURAS_AUDITADAS.test(action.body)) conEscritura += 1;
      }
    }

    expect(conEscritura).toBeGreaterThan(0);
  });

  it('el `actor` de texto no se reemplazó por el id en ningún lado', async () => {
    // Las dos columnas conviven a propósito: el texto es la verdad histórica
    // y sobrevive al borrado del usuario (la FK es ON DELETE SET NULL).
    const orders = await readCode(path.join('src', 'domain', 'orders.ts'));
    expect(orders).toMatch(/actor,/);
    expect(orders).toMatch(/actorUserId/);
  });
});
