import { describe, expect, it } from 'vitest';

import {
  checkDocker,
  checkGitRemote,
  checkMainAlDia,
  checkNode,
  checkPnpm,
  DIAS_DERIVA,
  DIAS_DERIVA_UNA_SOLA,
  esEntornoSinDocker,
  evaluarDeriva,
  parseArgs,
} from '../../scripts/doctor';

/**
 * `pnpm doctor` (NEW-STORE.md §1) — sólo las funciones puras de clasificación.
 * El comando real toca `docker`, `git` y el sistema de archivos; eso no se
 * testea acá, se lee a ojo corriéndolo.
 */

describe('checkNode', () => {
  it('bloquea por debajo del mínimo', () => {
    expect(checkNode('v18.19.0', '22').severity).toBe('bloquea');
  });

  it('bloquea por encima del máximo', () => {
    expect(checkNode('v25.0.0', '22').severity).toBe('bloquea');
  });

  it('ok dentro del rango aunque no coincida con .nvmrc', () => {
    expect(checkNode('v20.11.0', '22').severity).toBe('ok');
  });
});

describe('checkPnpm', () => {
  it('bloquea si no está instalado', () => {
    expect(checkPnpm(null, 'pnpm@11.22.0').severity).toBe('bloquea');
  });

  it('advierte si el major no coincide con packageManager', () => {
    expect(checkPnpm('9.1.0', 'pnpm@11.22.0').severity).toBe('advierte');
  });

  it('ok si coincide', () => {
    expect(checkPnpm('11.22.0', 'pnpm@11.22.0').severity).toBe('ok');
  });
});

describe('parseArgs', () => {
  it('sin banderas no saltea nada', () => {
    expect(parseArgs([])).toEqual({ skipDocker: false });
  });

  it('--skip-docker', () => {
    expect(parseArgs(['--skip-docker']).skipDocker).toBe(true);
  });

  it('una opción desconocida no se ignora', () => {
    expect(() => parseArgs(['--skipdocker'])).toThrow(/no conozco/);
  });
});

describe('checkDocker', () => {
  it('en una máquina de verdad bloquea si el binario no existe', () => {
    expect(checkDocker(false, false).severity).toBe('bloquea');
  });

  it('en una máquina de verdad bloquea si el daemon no responde', () => {
    expect(checkDocker(false, true).severity).toBe('bloquea');
  });

  it('ok si el daemon responde', () => {
    expect(checkDocker(true, true).severity).toBe('ok');
  });

  it('--skip-docker advierte y no bloquea', () => {
    // Bloquear acá es bloquear por algo que en ese entorno no tiene arreglo:
    // las tres primeras tiendas se bootstrapearon desde una sesión en la nube.
    const resultado = checkDocker(false, false, { omitido: true });
    expect(resultado.severity).toBe('advierte');
    expect(resultado.detail).toMatch(/docker compose up -d/);
  });

  it('en un contenedor advierte en vez de bloquear, con o sin binario', () => {
    expect(checkDocker(false, false, { entornoSinDocker: true }).severity).toBe('advierte');
    expect(checkDocker(false, true, { entornoSinDocker: true }).severity).toBe('advierte');
  });

  it('un contenedor con daemon de verdad sigue siendo ok', () => {
    expect(checkDocker(true, true, { entornoSinDocker: true }).severity).toBe('ok');
  });
});

describe('esEntornoSinDocker', () => {
  it('una laptop no es un entorno sin Docker', () => {
    // El falso positivo acá sería peor que el falso negativo: degradaría a
    // advertencia el "abrí Docker Desktop", que es el bloqueo que más sirve.
    expect(esEntornoSinDocker({ HOME: '/Users/anton', SHELL: '/bin/zsh' }, false)).toBe(false);
  });

  it('reconoce contenedores, Codespaces y CI', () => {
    expect(esEntornoSinDocker({}, true)).toBe(true);
    expect(esEntornoSinDocker({ CODESPACES: 'true' }, false)).toBe(true);
    expect(esEntornoSinDocker({ GITPOD_WORKSPACE_ID: 'x' }, false)).toBe(true);
    expect(esEntornoSinDocker({ CI: 'true' }, false)).toBe(true);
  });
});

/**
 * "main se quedó atrás" — el caso de lenceria: meses de trabajo mergeado en PRs
 * viviendo en ramas que nunca bajaron a `main`, y `main` con un ajuste de CI y
 * nada más. Nada lo avisó hasta que alguien miró `git log` a mano.
 *
 * El otro lado, igual de importante: un repo sano con un feature branch en
 * vuelo **no** tiene que avisar nada, o el aviso se vuelve ruido y se ignora.
 */
describe('evaluarDeriva', () => {
  const DIA = 24 * 60 * 60 * 1000;
  const MAIN = Date.parse('2026-01-01T00:00:00Z');
  const rama = (nombre: string, dias: number, adelante = 3) => ({
    nombre,
    fechaTip: MAIN + dias * DIA,
    adelante,
  });

  it('no avisa por una sola rama en vuelo', () => {
    expect(evaluarDeriva(MAIN, [rama('feature/x', 20)])).toBeNull();
  });

  it('no avisa por ramas ya mergeadas, por muchas que sean', () => {
    // adelante === 0: `main` las contiene. Que la punta sea "más nueva" es sólo
    // la fecha del merge.
    const mergeadas = [rama('a', 30, 0), rama('b', 40, 0), rama('c', 60, 0)];
    expect(evaluarDeriva(MAIN, mergeadas)).toBeNull();
  });

  it('no avisa por ramas viejas y abandonadas', () => {
    // Anteriores a `main`: eso es basura para borrar, no deriva.
    expect(evaluarDeriva(MAIN, [rama('vieja-1', -60), rama('vieja-2', -90)])).toBeNull();
  });

  it('no avisa mientras el trabajo sea reciente', () => {
    const reciente = DIAS_DERIVA - 1;
    expect(evaluarDeriva(MAIN, [rama('a', reciente), rama('b', reciente)])).toBeNull();
  });

  it('avisa con dos ramas o más con trabajo más nuevo sin mergear', () => {
    const deriva = evaluarDeriva(MAIN, [
      rama('origin/claude/marca', 30),
      rama('origin/claude/catalogo', 45),
      rama('feature/en-vuelo', 2),
    ]);
    expect(deriva).not.toBeNull();
    // Ordenadas por cuánto se adelantaron, y sin la que todavía es reciente.
    expect(deriva?.ramas.map((r) => r.nombre)).toEqual([
      'origin/claude/catalogo',
      'origin/claude/marca',
    ]);
    expect(deriva?.diasMax).toBe(45);
  });

  it('avisa por una sola rama recién cuando ya es trabajo olvidado', () => {
    expect(evaluarDeriva(MAIN, [rama('sola', DIAS_DERIVA_UNA_SOLA - 1)])).toBeNull();
    expect(evaluarDeriva(MAIN, [rama('sola', DIAS_DERIVA_UNA_SOLA + 1)])).not.toBeNull();
  });
});

describe('checkMainAlDia', () => {
  it('avisa, pero nunca bloquea el bootstrap', () => {
    const check = checkMainAlDia({
      ramas: [{ nombre: 'origin/claude/marca', dias: 30, adelante: 12 }],
      diasMax: 30,
    });
    expect(check.severity).toBe('advierte');
    expect(check.detail).toMatch(/origin\/claude\/marca/);
    expect(check.detail).toMatch(/\+12 commit/);
  });

  it('sin deriva, ok', () => {
    expect(checkMainAlDia(null).severity).toBe('ok');
  });

  it('"no pude mirarlo" no se reporta como "está al día"', () => {
    expect(checkMainAlDia(null, false).detail).toMatch(/no pude mirarlo/);
  });
});

describe('checkGitRemote', () => {
  it('advierte si falta "template" (se puede agregar después)', () => {
    expect(checkGitRemote('template', null, null).severity).toBe('advierte');
  });

  it('bloquea si falta "origin"', () => {
    expect(checkGitRemote('origin', null, null).severity).toBe('bloquea');
  });

  it('bloquea si el remoto existe pero no responde', () => {
    const resultado = checkGitRemote('template', 'git@github.com:x/y.git', false);
    expect(resultado.severity).toBe('bloquea');
    expect(resultado.detail).toMatch(/SSH key/);
  });

  it('ok si responde', () => {
    expect(checkGitRemote('origin', 'https://github.com/x/y.git', true).severity).toBe('ok');
  });
});
