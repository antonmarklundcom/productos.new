import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TEMAS } from '../../scripts/nueva-tienda';

/**
 * Kit de piel (plan-crecimiento §6.2): todos los temas tienen que definir
 * exactamente el mismo conjunto de variables CSS en `:root` y en `.dark`.
 * Una variable que le falte a un tema no rompe el build —Tailwind no avisa
 * de una custom property que no existe— pero deja un botón o un texto
 * invisible en esa combinación de tema/modo. Esto lo lee de los `.css`
 * reales, no de memoria: es la única forma de que el test detecte un tema
 * nuevo que se escribió incompleto.
 *
 * Los temas son **todos los `.css` de `src/styles/temas/`**, no la lista
 * `TEMAS` del wizard: una tienda con su propio tema (NEW-STORE.md §5) no
 * tiene que tocar `scripts/nueva-tienda.ts`, que es maquinaria y chocaría en
 * el próximo `template:sync`. `TEMAS` sólo tiene que existir en disco.
 */

const DIR_TEMAS = path.join('src', 'styles', 'temas');
const TEMAS_EN_DISCO = readdirSync(DIR_TEMAS)
  .filter((archivo) => archivo.endsWith('.css'))
  .map((archivo) => archivo.replace(/\.css$/, ''))
  // neutro primero: es la referencia contra la que se comparan los demás.
  .sort((a, b) => (a === 'neutro' ? -1 : b === 'neutro' ? 1 : a.localeCompare(b)));

function leerTema(nombre: string): string {
  return readFileSync(path.join(DIR_TEMAS, `${nombre}.css`), 'utf8');
}

/** El bloque `selector { … }` de nivel superior, o null si no está. */
function bloque(source: string, selector: string): string | null {
  const inicio = source.indexOf(`${selector} {`);
  if (inicio === -1) return null;
  const abre = source.indexOf('{', inicio);
  let nivel = 0;
  for (let i = abre; i < source.length; i += 1) {
    if (source[i] === '{') nivel += 1;
    else if (source[i] === '}') {
      nivel -= 1;
      if (nivel === 0) return source.slice(abre, i + 1);
    }
  }
  return null;
}

/** `--nombre:` → `nombre`, en el orden en que aparecen. */
function variables(bloqueCss: string): string[] {
  return [...bloqueCss.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1] ?? '');
}

describe('kit de piel: paridad de variables entre temas', () => {
  const porTema = Object.fromEntries(TEMAS_EN_DISCO.map((tema) => [tema, leerTema(tema)]));

  it('los temas que ofrece el wizard existen en disco', () => {
    for (const tema of TEMAS) {
      expect(TEMAS_EN_DISCO, `falta src/styles/temas/${tema}.css`).toContain(tema);
    }
  });

  it('todos los archivos existen y no están vacíos', () => {
    for (const tema of TEMAS_EN_DISCO) {
      expect(porTema[tema]?.length ?? 0, `${tema}.css está vacío`).toBeGreaterThan(0);
    }
  });

  it('cada tema define un bloque :root y un bloque .dark', () => {
    for (const tema of TEMAS_EN_DISCO) {
      expect(bloque(porTema[tema] ?? '', ':root'), `${tema}.css sin :root`).not.toBeNull();
      expect(bloque(porTema[tema] ?? '', '.dark'), `${tema}.css sin .dark`).not.toBeNull();
    }
  });

  it('todos los :root definen exactamente el mismo conjunto de variables', () => {
    const [primero = 'neutro', ...resto] = TEMAS_EN_DISCO;
    const base = new Set(variables(bloque(porTema[primero] ?? '', ':root') ?? ''));
    expect(base.size, 'neutro.css:root no tiene variables').toBeGreaterThan(0);

    for (const tema of resto) {
      const propias = new Set(variables(bloque(porTema[tema] ?? '', ':root') ?? ''));
      expect(propias, `:root de ${tema}.css difiere de neutro.css`).toEqual(base);
    }
  });

  it('todos los .dark definen exactamente el mismo conjunto de variables', () => {
    const [primero = 'neutro', ...resto] = TEMAS_EN_DISCO;
    const base = new Set(variables(bloque(porTema[primero] ?? '', '.dark') ?? ''));
    expect(base.size, 'neutro.css .dark no tiene variables').toBeGreaterThan(0);

    for (const tema of resto) {
      const propias = new Set(variables(bloque(porTema[tema] ?? '', '.dark') ?? ''));
      expect(propias, `.dark de ${tema}.css difiere de neutro.css`).toEqual(base);
    }
  });

  it('cada tema documenta para quién es, las fuentes y las líneas de layout.tsx', () => {
    for (const tema of TEMAS_EN_DISCO) {
      const source = porTema[tema] ?? '';
      const cabecera = source.slice(0, source.indexOf('*/') + 2);
      expect(cabecera, `${tema}.css sin "Para quién"`).toMatch(/Para qui[ée]n/i);
      expect(cabecera, `${tema}.css sin fuentes sugeridas`).toMatch(/[Ff]uentes sugeridas/);
      expect(cabecera, `${tema}.css sin mención a layout.tsx`).toMatch(/layout\.tsx/);
    }
  });

  it('neutro.css es exactamente lo que había en globals.css antes de esta fase', () => {
    // Los valores de hoy, movidos byte a byte (plan §6.2.A): si alguno de
    // estos dos números cambia, alguien "retocó" el tema por accidente y
    // las capturas de CI van a salir distintas de las de antes de esta fase.
    expect(porTema.neutro).toContain('--radius: 0.625rem;');
    expect(porTema.neutro).toContain('--background: oklch(1 0 0);');
    expect(porTema.neutro).toContain('--primary: oklch(0.205 0 0);');
    const dark = bloque(porTema.neutro ?? '', '.dark') ?? '';
    expect(dark).toContain('--background: oklch(0.145 0 0);');
    expect(dark).toContain('--primary: oklch(0.922 0 0);');
  });

  it('globals.css importa un tema real y ya no define :root/.dark', () => {
    const globals = readFileSync(path.join('src', 'app', 'globals.css'), 'utf8');
    const match = /@import\s+"\.\.\/styles\/temas\/([a-z0-9-]+)\.css";/.exec(globals);
    expect(match, 'globals.css no tiene el @import de un tema').not.toBeNull();
    expect(TEMAS_EN_DISCO).toContain(match?.[1]);
    expect(globals).not.toMatch(/^:root\s*\{/m);
    expect(globals).not.toMatch(/^\.dark\s*\{/m);
  });
});
