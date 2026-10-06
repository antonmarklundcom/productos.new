import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readCode } from '../helpers/source';

/**
 * `CLOUDINARY_FOLDER_PREFIX` (PLAN.md FASE 2, PR U).
 *
 * El prefijo existe por un choque concreto: el `public_id` de un comprobante
 * sale del número de pedido, y los números se repiten entre tiendas — todas
 * acuñan `PY-000123`. Con dos tiendas en una misma cuenta de Cloudinary y sin
 * prefijo, los comprobantes de las dos caen en la misma carpeta.
 *
 * Las carpetas se resuelven en cada llamada (el prefijo también se puede
 * cargar desde /admin/integraciones), pero cada caso reimporta igual para
 * arrancar sin foto de integraciones.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function folders(prefix: string | undefined) {
  vi.resetModules();
  vi.stubEnv('CLOUDINARY_FOLDER_PREFIX', prefix ?? '');
  return import('../../src/lib/cloudinary');
}

describe('las carpetas de Cloudinary', () => {
  it('sin prefijo son las de siempre', async () => {
    const {
      carpetaProductos,
      carpetaComprobantes,
      carpetaBanco,
      carpetaCategorias,
    } = await folders('');

    expect(carpetaProductos()).toBe('productos');
    expect(carpetaComprobantes()).toBe('comprobantes');
    expect(carpetaBanco()).toBe('banco');
    expect(carpetaCategorias()).toBe('categorias');
  });

  it('con prefijo cuelgan todas de él, incluidos los comprobantes', async () => {
    const {
      carpetaProductos,
      carpetaComprobantes,
      carpetaBanco,
      carpetaCategorias,
    } = await folders('lenceria');

    expect(carpetaCategorias()).toBe('lenceria/categorias');
    expect(carpetaProductos()).toBe('lenceria/productos');
    // Ésta es la que importa: es la que colisiona entre tiendas.
    expect(carpetaComprobantes()).toBe('lenceria/comprobantes');
    expect(carpetaBanco()).toBe('lenceria/banco');
  });

  it('tolera las barras que escribe alguien apurado', async () => {
    const { carpetaProductos } = await folders('/lenceria/');
    expect(carpetaProductos()).toBe('lenceria/productos');
  });

  it('un prefijo de sólo espacios es no tener prefijo', async () => {
    const { carpetaComprobantes } = await folders('   ');
    expect(carpetaComprobantes()).toBe('comprobantes');
  });

  it('acepta un prefijo anidado', async () => {
    const { carpetaComprobantes } = await folders('clientes/lenceria');
    expect(carpetaComprobantes()).toBe('clientes/lenceria/comprobantes');
  });

  /**
   * La constante existe desde O7, pero hasta O14 nadie subía a ella: la foto
   * de una categoría se cargaba pegando el `public_id` a mano. Ahora que
   * `uploadCategoryImage` sube de verdad, este test cuida que use **la
   * función del prefijo** y no un `"categorias"` literal, que es como se pierde el
   * prefijo de una tienda que comparte cuenta de Cloudinary.
   */
  it('la subida de la foto de categoría usa la constante, no un literal', async () => {
    const code = await readCode(path.join('src', 'app', 'actions', 'admin-categories.ts'));

    expect(code).toMatch(/folder:\s*carpetaCategorias\(\)/);
    expect(code).not.toMatch(/folder:\s*['"`]categorias/);
  });
});
