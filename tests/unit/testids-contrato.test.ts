import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TESTIDS } from '@/lib/testids';

import { SEED_CATEGORIES, SEED_PRODUCTS } from '../../scripts/seed-data';
import { listSourceFiles, readCode } from '../helpers/source';

/**
 * Guardarraíl del contrato de `data-testid` (NEW-STORE.md §5, `src/lib/testids.ts`).
 *
 * Los specs de `tests/e2e/**` rompían en cada tienda clonada porque
 * localizaban por texto y markup del seed —nombres de categoría, slugs de
 * producto demo— en vez de por un hook estable (pasó en
 * `antonmarklundcom/lenceria` PR #29). Este test cubre las dos mitades de que
 * eso no vuelva a pasar sin que nadie lo note:
 *
 * 1. **Todo id del contrato se usa de verdad.** Un id que nadie referencia en
 *    `src/` es un hook fantasma: se puede borrar del componente sin que
 *    ningún test se entere, y el día que un spec lo necesite va a fallar en
 *    silencio contra un `data-testid` que no existe.
 * 2. **Ningún spec vuelve a hardcodear el catálogo.** Se lee el seed de
 *    verdad (`scripts/seed-data.ts`) en vez de copiar la lista acá: si mañana
 *    se agrega un producto o categoría al seed, este test lo detecta solo.
 *    La regla es deliberadamente más ancha que "sólo adentro de un
 *    `getByText`/`getByRole`": un slug hardcodeado en un `page.goto(...)`
 *    rompe exactamente igual (era el caso de `csp.spec.ts` antes de este PR),
 *    así que cualquier aparición del término cuenta.
 */

const SRC_ROOTS = [path.join('src')];
const E2E_ROOT = path.join('tests', 'e2e');
// El módulo de definición no cuenta como "uso": ahí es donde nace el string,
// no donde se consulta.
const DEFINITION_FILE = path.join('src', 'lib', 'testids.ts');

describe('contrato de data-testid (src/lib/testids.ts)', () => {
  it('cada id del contrato aparece referenciado en src/ fuera de su propia definición', async () => {
    const files = (await listSourceFiles(SRC_ROOTS)).filter((file) => file !== DEFINITION_FILE);
    const code = (await Promise.all(files.map((file) => readCode(file)))).join('\n');

    const sinUso = Object.keys(TESTIDS).filter(
      (key) => !new RegExp(`TESTIDS\\.${key}\\b`).test(code)
    );

    expect(sinUso).toEqual([]);
  });

  it('ningún data-testid/getByTestId de un spec de e2e apunta a un id fuera del contrato', async () => {
    const files = await listSourceFiles([E2E_ROOT]);
    const valoresValidos = new Set<string>(Object.values(TESTIDS));

    const invalidos: string[] = [];
    for (const file of files) {
      const code = await readCode(file);
      const matches = code.matchAll(
        /data-testid=["']([^"']+)["']|getByTestId\(["']([^"']+)["']\)/g
      );
      for (const match of matches) {
        const value = match[1] ?? match[2];
        // `data-testid="${TESTIDS.foo}"` dentro de un selector CSS armado a
        // mano (`helpers.ts`) es un literal dinámico, no un id fuera del
        // contrato — lo que hay que validar ahí es la referencia a `TESTIDS`,
        // que ya cubre el test de arriba.
        if (value && !value.includes('${') && !valoresValidos.has(value)) {
          invalidos.push(`${file}: "${value}"`);
        }
      }
    }

    expect(invalidos).toEqual([]);
  });
});

describe('los specs de e2e no conocen el catálogo de la tienda', () => {
  it('ningún spec (ni sus helpers) contiene un nombre o slug del seed', async () => {
    /**
     * Nombres y slugs de las cuatro categorías y los ~24 productos del seed
     * (`scripts/seed-data.ts`). Ninguno tiene que aparecer como literal en
     * `tests/e2e/**`: ni en un `getByText`, ni en un `getByRole({ name })`, ni
     * en una URL armada a mano — los tres son la misma fragilidad.
     */
    const terminosDelSeed = [
      ...SEED_CATEGORIES.flatMap((categoria) => [categoria.slug, categoria.name]),
      ...SEED_PRODUCTS.flatMap((producto) => [producto.slug, producto.name]),
    ];

    const files = await listSourceFiles([E2E_ROOT]);
    const offenders: string[] = [];

    for (const file of files) {
      const code = await readCode(file);
      for (const termino of terminosDelSeed) {
        if (code.includes(termino)) offenders.push(`${file}: "${termino}"`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
