import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../helpers/source';

/**
 * `stripComments()` es el ojo de media docena de tests de seguridad
 * (`security-review`, `marca-centralizada`, `no-raw-status-update`,
 * `admin-guards`…): todos leen el código con esto y después afirman qué hay y
 * qué no hay adentro.
 *
 * Por eso se testea aparte. Si el escáner se come código de más, los tests que
 * dicen "esto **no** puede aparecer" pasan en verde **porque ya no están
 * mirando nada** — el peor modo de falla que puede tener un test: silencioso y
 * tranquilizador. Los dos casos de abajo no son hipotéticos; los dos
 * rompieron.
 */

describe('stripComments', () => {
  it('saca comentarios de línea y de bloque', () => {
    expect(stripComments('const a = 1; // nota\nconst b = 2;')).not.toContain('nota');
    expect(stripComments('/* nota */ const a = 1;')).not.toContain('nota');
    expect(stripComments('const a = 1; // nota\nconst b = 2;')).toContain('const b = 2;');
  });

  it('no toca lo que hay adentro de un string', () => {
    // El caso real: `src/proxy.ts` tiene "https://*.google-analytics.com". Ese
    // `/*` abría un comentario para la versión vieja, y el primer `*​/` de más
    // abajo lo cerraba, borrando el CSP entero del medio.
    const code = [
      'const hosts = "https://*.google-analytics.com";',
      'const csp = "frame-ancestors \'none\'";',
      'const x = 1; /* esto sí es un comentario */',
    ].join('\n');
    const salida = stripComments(code);

    expect(salida).toContain('google-analytics.com');
    expect(salida).toContain("frame-ancestors 'none'");
    expect(salida).not.toContain('esto sí es un comentario');
  });

  it('no toma las comillas de una regex como apertura de string', () => {
    // El caso real: `scripts/nueva-tienda.ts` tiene esta regex. La comilla de
    // adentro desincronizaba al escáner **hasta el final del archivo**, y los
    // comentarios de más abajo dejaban de reconocerse como comentarios.
    const code = [
      'const partes = crudo.matchAll(/"((?:[^"\\\\]|\\\\.)*)"|\'((?:[^\'\\\\]|\\\\.)*)\'/g);',
      '/* un comentario después de la regex */',
      'const marca = "AcaEstoy";',
    ].join('\n');
    const salida = stripComments(code);

    expect(salida).not.toContain('un comentario después de la regex');
    expect(salida).toContain('AcaEstoy');
  });

  it('una barra dentro de una clase de caracteres no cierra la regex', () => {
    const salida = stripComments('const re = /[/"]x/g;\n/* comentario */\nconst z = 1;');
    expect(salida).not.toContain('comentario');
    expect(salida).toContain('const z = 1;');
  });

  it('una división sigue siendo una división', () => {
    const salida = stripComments('const mitad = total / 2;\n// nota\nconst z = 1;');
    expect(salida).toContain('total / 2');
    expect(salida).not.toContain('nota');
    expect(salida).toContain('const z = 1;');
  });

  it('sobre los archivos de verdad no se come el código que los tests revisan', () => {
    // La prueba de fuego: los dos archivos que rompieron cada versión.
    const proxy = stripComments(readFileSync(path.join('src', 'proxy.ts'), 'utf8'));
    expect(proxy).toContain('Content-Security-Policy');
    expect(proxy).toContain("frame-ancestors 'none'");
    expect(proxy).toContain('RUTAS_CACHEADAS');

    const wizard = stripComments(readFileSync(path.join('scripts', 'nueva-tienda.ts'), 'utf8'));
    expect(wizard).toContain('reescribirTienda');
    // Todas las apariciones del nombre del template ahí son comentarios: si
    // alguna sobrevive, el escáner volvió a desincronizarse.
    expect(wizard.toLowerCase()).not.toContain('tiendapy');
  });
});
