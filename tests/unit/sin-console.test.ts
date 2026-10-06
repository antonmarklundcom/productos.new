import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listSourceFiles, readCode } from '../helpers/source';

/**
 * Guardarraíl de O8: en el servidor se loguea con `log`, no con `console`.
 *
 * No es estilo. Un `console.log` suelto se lleva puesto lo que le pasen —el
 * objeto entero del pedido, con teléfono y dirección— mientras que `log`
 * redacta los campos sensibles por nombre antes de imprimir. Y sale sin
 * `reqId`, así que la línea que más importa en un incidente es justo la que no
 * se puede cruzar con las demás.
 *
 * Mismo patrón que `no-raw-status-update.test.ts`: el grep de la regla,
 * corriendo en CI para que siga siendo cierta cuando el código crezca.
 */

const RAICES = [path.join('src', 'domain'), path.join('src', 'app', 'api')];

/**
 * La única excepción, con nombre y apellido: el sender de consola de dev
 * **es** una salida por consola. Su trabajo es imprimir el mensaje que
 * hubiera salido por WhatsApp, para poder recorrer el flujo sin cuenta de
 * Meta. Pasarlo por `log` redactaría justamente lo que se quiere ver, y
 * `resolveMessageSender` ya se niega a devolverlo con `NODE_ENV=production`.
 */
const PERMITIDOS = new Set([path.join('src', 'domain', 'messaging', 'index.ts')]);

describe('el servidor loguea con `log`, no con `console`', () => {
  it('no hay `console.*` suelto en src/domain ni en src/app/api', async () => {
    const offenders: string[] = [];

    for (const file of await listSourceFiles(RAICES)) {
      if (PERMITIDOS.has(file)) continue;
      const code = await readCode(file);

      for (const [linea] of code.matchAll(/console\.\w+\([^\n]*/g)) {
        offenders.push(`${file}: ${linea.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('el test no se quedó sin objetivo: hay archivos que loguean', async () => {
    let conLog = 0;
    for (const file of await listSourceFiles(RAICES)) {
      if (/\blog\.(info|warn|error)\s*\(/.test(await readCode(file))) conLog += 1;
    }
    expect(conLog).toBeGreaterThan(5);
  });

  it('la excepción sigue siendo la que dice el comentario', async () => {
    // Si alguien borra el sender de consola, esta lista tiene que encogerse
    // con él en vez de quedar como un permiso huérfano.
    for (const permitido of PERMITIDOS) {
      const code = await readCode(permitido);
      expect(code).toContain('createConsoleSender');
    }
  });
});
