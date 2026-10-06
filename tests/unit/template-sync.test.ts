import { describe, expect, it } from 'vitest';

import type { Commit } from '../../scripts/template-shared';
import {
  decidirArchivo,
  esTest,
  fusionarPackageJson,
  hayQueHacer,
  parseArgs,
  resumenJson,
  resumenVacio,
  versionMasVieja,
} from '../../scripts/template-sync';

/**
 * `pnpm template:sync`. Todo acá es cálculo puro — nada de red, nada de un
 * repo real. El comportamiento con git de verdad (merge de 3 vías, marcadores,
 * el commit) lo cubre tests/integration/template-sync.test.ts.
 */

describe('parseArgs', () => {
  it('por defecto no hace dry-run, no para en ningún sha, y corre los tests', () => {
    expect(parseArgs([])).toEqual({
      remoto: 'template',
      rama: 'main',
      dryRun: false,
      hasta: null,
      sinTests: false,
      ramaDestino: null,
      json: false,
      commitearConflictos: false,
    });
  });

  it('--dry-run, --sin-tests, --json y --commitear-conflictos son flags sueltos', () => {
    const opciones = parseArgs(['--dry-run', '--sin-tests', '--json', '--commitear-conflictos']);
    expect(opciones).toMatchObject({ dryRun: true, sinTests: true, json: true, commitearConflictos: true });
  });

  it('--hasta, --remoto, --rama y --rama-destino toman el valor que sigue', () => {
    expect(
      parseArgs(['--hasta', 'abc1234', '--remoto', 'upstream', '--rama', 'produccion', '--rama-destino', 'template/sync']),
    ).toMatchObject({ hasta: 'abc1234', remoto: 'upstream', rama: 'produccion', ramaDestino: 'template/sync' });
  });

  it('una opción desconocida o sin valor no se ignora', () => {
    expect(() => parseArgs(['--hasta'])).toThrow(/espera un valor/);
    expect(() => parseArgs(['--hasta', '--sin-tests'])).toThrow(/espera un valor/);
    expect(() => parseArgs(['--rama-destino'])).toThrow(/espera un valor/);
    expect(() => parseArgs(['--marcar'])).toThrow(/no conozco/);
  });
});

describe('decidirArchivo', () => {
  // base = template en el baseline, tienda = HEAD de la tienda, template = objetivo.
  const v = (base: string | null, tienda: string | null, template: string | null) => ({ base, tienda, template });

  it('fable/, Dependabot, tiendas.json y el baseline nunca viajan', () => {
    for (const ruta of ['fable/plan.md', '.github/dependabot.yml', 'tiendas.json', '.template-baseline']) {
      expect(decidirArchivo(ruta, v('a', 'a', 'b')), ruta).toBe('ignorar');
      expect(decidirArchivo(ruta, v(null, null, 'b')), ruta).toBe('ignorar');
    }
  });

  it('si la tienda ya tiene lo del template, no hay nada que hacer', () => {
    expect(decidirArchivo('src/domain/stock.ts', v('a', 'b', 'b'))).toBe('al-dia');
    expect(decidirArchivo('README.md', v('a', null, null))).toBe('al-dia');
    expect(decidirArchivo('pnpm-lock.yaml', v('a', 'b', 'b'))).toBe('al-dia');
  });

  it('lo que la tienda no tocó toma la versión del template: maquinaria o piel, nuevo o borrado', () => {
    expect(decidirArchivo('src/domain/stock.ts', v('a', 'a', 'b'))).toBe('tomar-template');
    expect(decidirArchivo('src/components/hero.tsx', v('a', 'a', 'b'))).toBe('tomar-template');
    expect(decidirArchivo('scripts/nuevo.ts', v(null, null, 'b'))).toBe('tomar-template');
    expect(decidirArchivo('src/lib/viejo.ts', v('a', 'a', null))).toBe('tomar-template');
  });

  it('los docs del template toman la versión del template aunque la tienda los haya tocado', () => {
    for (const ruta of ['KNOWN-ISSUES.md', 'ARCH.md', 'NEW-STORE.md', 'CHANGELOG.md']) {
      expect(decidirArchivo(ruta, v('a', 'x', 'b')), ruta).toBe('tomar-template');
    }
  });

  it('piel o docs que la tienda cambió (o borró) se quedan como están', () => {
    expect(decidirArchivo('README.md', v('a', 'x', 'b'))).toBe('conservar');
    expect(decidirArchivo('CLAUDE.md', v('a', 'x', 'b'))).toBe('conservar');
    expect(decidirArchivo('src/app/page.tsx', v('a', 'x', 'b'))).toBe('conservar');
    expect(decidirArchivo('src/components/product-card.tsx', v('a', null, 'b'))).toBe('conservar');
    // Los mixtos también: el resumen los lista aparte para mirarlos a mano.
    expect(decidirArchivo('src/components/checkout-form.tsx', v('a', 'x', 'b'))).toBe('conservar');
  });

  it('maquinaria cambiada de los dos lados se fusiona', () => {
    for (const ruta of [
      'src/domain/stock.ts',
      'src/app/actions/checkout.ts',
      'scripts/doctor.ts',
      'drizzle/meta/_journal.json',
      'tests/unit/stock.test.ts',
      'package.json',
      'src/i18n/es-PY.ts',
    ]) {
      expect(decidirArchivo(ruta, v('a', 'x', 'b')), ruta).toBe('fusionar');
    }
  });

  it('maquinaria que la tienda no tiene vuelve; la que el template borró y la tienda cambió es un conflicto', () => {
    expect(decidirArchivo('src/lib/spreadsheet.ts', v('a', null, 'b'))).toBe('restaurar');
    expect(decidirArchivo('src/lib/spreadsheet.ts', v('a', 'x', null))).toBe('conflicto');
  });

  it('pnpm-lock.yaml se decide aparte, al final', () => {
    expect(decidirArchivo('pnpm-lock.yaml', v('a', 'a', 'b'))).toBe('lockfile');
    expect(decidirArchivo('pnpm-lock.yaml', v('a', 'x', 'b'))).toBe('lockfile');
  });
});

describe('hayQueHacer', () => {
  it('sólo al-dia, ignorar y conservar no escriben nada', () => {
    expect(
      hayQueHacer([
        { ruta: 'a', accion: 'al-dia' },
        { ruta: 'b', accion: 'ignorar' },
        { ruta: 'c', accion: 'conservar' },
      ]),
    ).toBe(false);
    expect(hayQueHacer([{ ruta: 'a', accion: 'tomar-template' }])).toBe(true);
    expect(hayQueHacer([{ ruta: 'pnpm-lock.yaml', accion: 'lockfile' }])).toBe(true);
  });
});

describe('esTest', () => {
  it('tests/ y los *.test.ts(x) sueltos', () => {
    expect(esTest('tests/unit/stock.test.ts')).toBe(true);
    expect(esTest('tests/e2e/helpers.ts')).toBe(true);
    expect(esTest('src/components/__tests__/cart.test.tsx')).toBe(true);
    expect(esTest('src/domain/stock.ts')).toBe(false);
  });
});

describe('fusionarPackageJson', () => {
  const json = (valor: unknown) => `${JSON.stringify(valor, null, 2)}\n`;

  it('dos scripts nuevos al final de la lista, uno de cada lado: línea por línea chocaban', () => {
    const base = json({ name: 'ecom', scripts: { dev: 'next dev', build: 'next build' } });
    const tienda = json({ name: 'mascota', scripts: { dev: 'next dev', build: 'next build', fotos: 'tsx fotos.ts' } });
    const template = json({ name: 'ecom', scripts: { dev: 'next dev', build: 'next build', restore: 'tsx restore.ts' } });

    const resultado = fusionarPackageJson(base, tienda, template);
    expect(resultado?.pisadas).toEqual([]);
    expect(JSON.parse(resultado!.contenido)).toEqual({
      name: 'mascota',
      scripts: { dev: 'next dev', build: 'next build', restore: 'tsx restore.ts', fotos: 'tsx fotos.ts' },
    });
  });

  it('lo que sólo tiene la tienda queda donde estaba, no al final', () => {
    const base = json({ devDependencies: { husky: '1', prettier: '1', vitest: '1' } });
    const tienda = json({ devDependencies: { husky: '1', 'lint-staged': '1', prettier: '1', vitest: '1' } });
    const template = json({ devDependencies: { husky: '1', prettier: '2', vitest: '1' } });

    const resultado = fusionarPackageJson(base, tienda, template);
    expect(Object.keys(JSON.parse(resultado!.contenido).devDependencies)).toEqual([
      'husky',
      'lint-staged',
      'prettier',
      'vitest',
    ]);
  });

  it('la misma dependencia subida de los dos lados: gana el template, y se avisa', () => {
    const base = json({ dependencies: { zod: '^4.5.0', next: '16.0.0' } });
    const tienda = json({ dependencies: { zod: '^4.5.4', next: '16.0.0' } });
    const template = json({ dependencies: { zod: '^4.6.1', next: '16.3.4' } });

    const resultado = fusionarPackageJson(base, tienda, template);
    expect(JSON.parse(resultado!.contenido).dependencies).toEqual({ zod: '^4.6.1', next: '16.3.4' });
    expect(resultado?.pisadas).toEqual(['dependencies.zod']);
  });

  it('lo que el template sacó y la tienda no tocó se va; lo que la tienda agregó se queda', () => {
    const base = json({ dependencies: { xlsx: '1', react: '19' } });
    const tienda = json({ dependencies: { xlsx: '1', react: '19', sharp: '0.33' } });
    const template = json({ dependencies: { exceljs: '4', react: '19' } });

    expect(JSON.parse(fusionarPackageJson(base, tienda, template)!.contenido).dependencies).toEqual({
      exceljs: '4',
      react: '19',
      sharp: '0.33',
    });
  });

  it('una dependencia de la tienda más vieja que la del template pierde, aunque el template no la haya cambiado', () => {
    // productos: el baseline ya tenía iron-session 9, la tienda seguía en 8 y
    // la maquinaria no compilaba. Por clave era "cambio de la tienda" y ganaba.
    const base = json({ dependencies: { 'iron-session': '^9.0.1', zod: '^4.0.0' } });
    const tienda = json({ dependencies: { 'iron-session': '^8.0.4', zod: '^4.2.0' } });
    const template = json({ dependencies: { 'iron-session': '^9.0.1', zod: '^4.0.0' } });

    const resultado = fusionarPackageJson(base, tienda, template);
    expect(JSON.parse(resultado!.contenido).dependencies).toEqual({
      'iron-session': '^9.0.1',
      // Más nueva que la del template: decisión de la tienda, se queda.
      zod: '^4.2.0',
    });
    expect(resultado?.pisadas).toEqual(['dependencies.iron-session']);
  });

  it('una devDependency vieja también', () => {
    const base = json({ devDependencies: { typescript: '^6.0.3' } });
    const tienda = json({ devDependencies: { typescript: '^5.9.3' } });
    const template = json({ devDependencies: { typescript: '^6.0.3' } });

    expect(JSON.parse(fusionarPackageJson(base, tienda, template)!.contenido).devDependencies).toEqual({
      typescript: '^6.0.3',
    });
  });

  it('JSON inválido de cualquier lado: null (vuelve al merge de líneas)', () => {
    expect(fusionarPackageJson('{}', '{ roto', '{}')).toBeNull();
  });
});

describe('resumenJson', () => {
  function commit(sha: string, asunto: string, maquinaria: boolean): Commit {
    return { sha, asunto, maquinaria, mixto: false };
  }

  it('sin-cambios y precondicion', () => {
    expect(resumenJson({ estado: 'sin-cambios' })).toEqual({ estado: 'sin-cambios' });
    expect(resumenJson({ estado: 'precondicion', mensaje: 'no' })).toEqual({ estado: 'precondicion', mensaje: 'no' });
  });

  it('completado: sólo los commits de maquinaria, con sha y asunto, y el resumen por archivo', () => {
    const resumen = { ...resumenVacio(), traidos: ['src/domain/stock.ts'] };
    expect(
      resumenJson({
        estado: 'completado',
        objetivo: 'fff',
        commits: [commit('aaa', 'Arreglo de stock', true), commit('bbb', 'Foto nueva', false)],
        resumen,
      }),
    ).toEqual({
      estado: 'completado',
      objetivo: 'fff',
      commits: [{ sha: 'aaa', asunto: 'Arreglo de stock' }],
      resumen,
    });
  });

  it('conflicto: trae los archivos y si quedó commiteado, para el PR en draft', () => {
    const resumen = { ...resumenVacio(), conflictos: [{ ruta: 'src/domain/stock.ts', motivo: 'chocó' }] };
    expect(
      resumenJson({ estado: 'conflicto', objetivo: 'fff', commits: [], resumen, commiteado: true, mensaje: 'm' }),
    ).toEqual({ estado: 'conflicto', objetivo: 'fff', commits: [], resumen, commiteado: true, mensaje: 'm' });
  });
});

describe('versionMasVieja', () => {
  it('compara el piso de cada rango', () => {
    expect(versionMasVieja('^8.0.4', '^9.0.1')).toBe(true);
    expect(versionMasVieja('19.2.8', '19.3.0')).toBe(true);
    expect(versionMasVieja('~3.24.2', '^3.24.4')).toBe(true);
    expect(versionMasVieja('^9.0.1', '^9.0.1')).toBe(false);
    expect(versionMasVieja('^4.2.0', '^4.0.0')).toBe(false);
  });

  it('lo que no es un número de versión no se toca', () => {
    expect(versionMasVieja('workspace:*', '^1.0.0')).toBe(false);
    expect(versionMasVieja('latest', '^1.0.0')).toBe(false);
    expect(versionMasVieja('^1.0.0', 'github:org/repo')).toBe(false);
  });
});
