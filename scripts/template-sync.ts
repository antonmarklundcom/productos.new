import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BASELINE_FILE,
  commitsClasificados,
  type Commit,
  contenidoBaseline,
  DOCS_DEL_TEMPLATE,
  esMaquinaria,
  esMixto,
  esSoloTemplate,
  gitEn,
  maquinariaFaltante,
  parseBaseline,
  remotoExiste,
  SOLO_TEMPLATE,
} from './template-shared';

/**
 * `pnpm template:sync` — traer la maquinaria del template con un comando.
 *
 * `pnpm template:diff` dice qué le falta a esta tienda; esto lo trae.
 *
 * Cómo: archivo por archivo, no commit por commit. Para cada archivo que el
 * template cambió entre el `.template-baseline` de la tienda y el objetivo
 * (`template/main`, o `--hasta`), mira tres versiones —la del template en el
 * baseline, la de la tienda y la del template en el objetivo— y decide:
 *
 *   - la tienda nunca lo tocó        → queda el del template (nuevo, cambiado o borrado)
 *   - doc del template (ARCH.md…)    → queda el del template
 *   - maquinaria que la tienda borró → se restaura (la maquinaria no se saca por tienda)
 *   - maquinaria que la tienda nunca tuvo → se restaura aunque el template no la haya cambiado
 *   - maquinaria cambiada de los dos lados → merge de 3 vías; si choca, conflicto
 *   - piel o docs que la tienda cambió → quedan los de la tienda (se listan)
 *   - `fable/`, Dependabot, `tiendas.json` → nunca viajan
 *   - `pnpm-lock.yaml`                → el del template, o se regenera
 *
 * Todo termina en **un** commit con el baseline nuevo. Si hubo conflictos,
 * los archivos quedan con los marcadores de siempre (`<<<<<<<`) y sin
 * commitear, para resolverlos y commitear a mano (con `--commitear-conflictos`,
 * que usa `distribuir.yml`, se commitean igual y el PR sale en draft).
 *
 * Antes (hasta v1.0.0) esto era un cherry-pick por commit. Con tiendas reales
 * no andaba: una tienda que no tenía un archivo de maquinaria, un test
 * salteado porque su commit no tocaba maquinaria, o un `CLAUDE.md` editado
 * por la tienda frenaban la corrida en el primer commit que los tocaba, aunque
 * el resultado final no tuviera ningún conflicto de verdad. Mirar sólo el
 * punto de partida y el de llegada saca del medio los estados intermedios.
 *
 *   pnpm template:sync                    # trae todo lo pendiente
 *   pnpm template:sync --dry-run          # qué haría, sin tocar nada
 *   pnpm template:sync --hasta <sha>      # sincroniza hasta ese commit del template
 *   pnpm template:sync --sin-tests        # no corre typecheck/lint/test al final
 *   pnpm template:sync --rama-destino <nombre>   # crea/usa esa rama antes de sincronizar
 *   pnpm template:sync --json             # resumen de una línea en JSON (para un PR automático)
 *   pnpm template:sync --commitear-conflictos    # commitea aunque queden marcadores
 *
 * `--rama-destino`, `--json` y `--commitear-conflictos` existen para
 * `distribuir.yml`: el workflow clona la tienda recién, no hay rama de feature
 * todavía, necesita un resumen que pueda leer sin parsear texto de terminal, y
 * necesita un commit para poder abrir el PR aunque algo haya chocado.
 */

const URL_TEMPLATE = 'https://github.com/antonmarklundcom/ecom.git';

export type Opciones = {
  remoto: string;
  rama: string;
  dryRun: boolean;
  hasta: string | null;
  sinTests: boolean;
  /** Opcional para no romper a quien construye `Opciones` a mano (tests viejos). */
  ramaDestino?: string | null;
  json?: boolean;
  commitearConflictos?: boolean;
};

export function parseArgs(argv: string[]): Opciones {
  const opciones: Opciones = {
    remoto: 'template',
    rama: 'main',
    dryRun: false,
    hasta: null,
    sinTests: false,
    ramaDestino: null,
    json: false,
    commitearConflictos: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];

    if (flag === '--dry-run') {
      opciones.dryRun = true;
      continue;
    }
    if (flag === '--sin-tests') {
      opciones.sinTests = true;
      continue;
    }
    if (flag === '--json') {
      opciones.json = true;
      continue;
    }
    if (flag === '--commitear-conflictos') {
      opciones.commitearConflictos = true;
      continue;
    }
    if (flag === '--hasta' || flag === '--remoto' || flag === '--rama' || flag === '--rama-destino') {
      const valor = argv[i + 1];
      if (!valor || valor.startsWith('--')) throw new Error(`${flag} espera un valor`);
      if (flag === '--hasta') opciones.hasta = valor;
      else if (flag === '--remoto') opciones.remoto = valor;
      else if (flag === '--rama') opciones.rama = valor;
      else opciones.ramaDestino = valor;
      i += 1;
      continue;
    }

    throw new Error(`no conozco la opción "${flag}"`);
  }

  return opciones;
}

// ---------------------------------------------------------------------------
// La decisión por archivo: pura, sin git, para poder testearla sola.
// ---------------------------------------------------------------------------

export type Accion =
  /** `fable/`, Dependabot, `tiendas.json`, el propio baseline: nunca viajan. */
  | 'ignorar'
  /** La tienda ya tiene exactamente lo del template. */
  | 'al-dia'
  /** Se resuelve al final, mirando cómo quedó `package.json`. */
  | 'lockfile'
  /** La tienda no lo tocó (o es un doc del template): va la versión del template. */
  | 'tomar-template'
  /** Maquinaria que la tienda no tiene: vuelve. */
  | 'restaurar'
  /** Maquinaria cambiada de los dos lados: merge de 3 vías. */
  | 'fusionar'
  /** Maquinaria que el template borró y la tienda cambió: lo decide una persona. */
  | 'conflicto'
  /** Piel o docs que la tienda cambió o borró: se queda lo de la tienda. */
  | 'conservar';

/** Blob de git de cada lado (`null` = el archivo no existe ahí). */
export type Versiones = { base: string | null; tienda: string | null; template: string | null };

export function decidirArchivo(ruta: string, { base, tienda, template }: Versiones): Accion {
  if (esSoloTemplate(ruta) || ruta === BASELINE_FILE) return 'ignorar';
  if (tienda === template) return 'al-dia';
  if (ruta === 'pnpm-lock.yaml') return 'lockfile';
  if ((DOCS_DEL_TEMPLATE as readonly string[]).includes(ruta)) return 'tomar-template';
  if (tienda === base) return 'tomar-template';

  // De acá para abajo, la tienda lo cambió, lo borró o lo agregó por su cuenta.
  if (!esMaquinaria(ruta)) return 'conservar';
  if (tienda === null) return 'restaurar';
  if (template === null) return 'conflicto';
  return 'fusionar';
}

export type ArchivoPlan = { ruta: string; accion: Accion };

export type Conflicto = { ruta: string; motivo: string };

/** Lo que queda escrito en el working tree, agrupado para contarlo. */
export type Resumen = {
  /** Del template: nuevos o cambiados que la tienda no había tocado (y restaurados). */
  traidos: string[];
  /** Borrados en el template que la tienda no había tocado. */
  borrados: string[];
  /** Maquinaria que la tienda no tenía y volvió. */
  restaurados: string[];
  /** Maquinaria cambiada de los dos lados que se fusionó sola. */
  fusionados: string[];
  /**
   * Cambios de la tienda que ganó el template: tests que chocaban (tienen que
   * ir con la maquinaria que prueban) y claves de `package.json` que los dos
   * cambiaron (`package.json → dependencies.zod`).
   */
  reemplazados: string[];
  /** Piel o docs que la tienda cambió: quedan los suyos. Los mixtos, además, en `mixtos`. */
  conservados: string[];
  /**
   * Piel que la tienda rediseñó y el template borró o renombró. Queda el
   * archivo de la tienda, pero nada del template lo importa ya: el rediseño
   * dejó de verse y en su lugar aparece la versión nueva del template.
   */
  huerfanos: string[];
  /** Mixtos (`checkout-form.tsx`, `/admin`) que el template cambió y la tienda tiene distintos. */
  mixtos: string[];
  conflictos: Conflicto[];
};

export function resumenVacio(): Resumen {
  return {
    traidos: [],
    borrados: [],
    restaurados: [],
    fusionados: [],
    reemplazados: [],
    conservados: [],
    huerfanos: [],
    mixtos: [],
    conflictos: [],
  };
}

type Json = null | boolean | number | string | Json[] | { [clave: string]: Json };

function esObjeto(valor: unknown): valor is { [clave: string]: Json } {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function igualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merge de 3 vías de `package.json` clave por clave, no línea por línea.
 *
 * Línea por línea chocaba siempre: la tienda sube `zod` y el template también,
 * o los dos agregan un script al final de `scripts` —líneas vecinas— y git no
 * puede separarlos. Por clave, casi todo se resuelve: lo que cambió un solo
 * lado gana; lo que cambiaron los dos (la misma dependencia a dos versiones)
 * lo gana el template, porque la maquinaria que viene con él se probó con esa
 * versión. Esas claves vuelven en `pisadas` para listarlas en el PR.
 *
 * Una excepción: en `dependencies`/`devDependencies`, una versión de la
 * tienda **más vieja** que la del template pierde siempre, aunque el template
 * no la haya cambiado desde el baseline. Casi nunca es una decisión de la
 * tienda sino un baseline marcado sin traer todo (productos quedó con
 * `iron-session` 8 cuando la maquinaria ya usaba la API de la 9, y el build no
 * pasaba). La maquinaria se prueba con la versión del template; si una tienda
 * de verdad necesita una más vieja, que la fije después del sync.
 *
 * Devuelve `null` si alguno de los tres no es JSON válido.
 */
export function fusionarPackageJson(
  base: string,
  tienda: string,
  template: string,
): { contenido: string; pisadas: string[] } | null {
  let b: unknown;
  let t: unknown;
  let m: unknown;
  try {
    b = base.trim() === '' ? {} : JSON.parse(base);
    t = JSON.parse(tienda);
    m = JSON.parse(template);
  } catch {
    return null;
  }
  if (!esObjeto(b) || !esObjeto(t) || !esObjeto(m)) return null;

  const pisadas: string[] = [];

  const fusionarNivel = (
    enBase: { [clave: string]: Json },
    enTienda: { [clave: string]: Json },
    enTemplate: { [clave: string]: Json },
    camino: string,
  ): { [clave: string]: Json } => {
    const salida: { [clave: string]: Json } = {};
    // El orden del template, con lo que sólo tiene la tienda metido donde la
    // tienda lo tenía (después de la misma clave vecina): el diff del PR
    // muestra sólo lo que cambió, no claves que se mudaron al final.
    const claves = Object.keys(enTemplate);
    let anterior: string | null = null;
    for (const clave of Object.keys(enTienda)) {
      if (!claves.includes(clave)) {
        claves.splice(anterior === null ? 0 : claves.indexOf(anterior) + 1, 0, clave);
      }
      anterior = clave;
    }
    for (const clave of claves) {
      const vb = enBase[clave];
      const vt = enTienda[clave];
      const vm = enTemplate[clave];
      const ruta = camino ? `${camino}.${clave}` : clave;
      let valor: Json | undefined;

      if (esObjeto(vt) && esObjeto(vm)) {
        valor = fusionarNivel(esObjeto(vb) ? vb : {}, vt, vm, ruta);
      } else if (
        SECCIONES_DE_DEPENDENCIAS.includes(camino) &&
        typeof vt === 'string' &&
        typeof vm === 'string' &&
        versionMasVieja(vt, vm)
      ) {
        valor = vm;
        if (!igualJson(vt, vb)) pisadas.push(ruta);
      } else if (igualJson(vt, vm) || igualJson(vt, vb)) {
        valor = vm;
      } else if (igualJson(vm, vb)) {
        valor = vt;
      } else {
        valor = vm;
        pisadas.push(ruta);
      }

      if (valor !== undefined) salida[clave] = valor;
    }
    return salida;
  };

  const fusionado = fusionarNivel(esObjeto(b) ? b : {}, t, m, '');
  return { contenido: `${JSON.stringify(fusionado, null, 2)}\n`, pisadas };
}

const SECCIONES_DE_DEPENDENCIAS = ['dependencies', 'devDependencies'];

/** `"^8.0.4"` → `[8, 0, 4]`; `null` si no empieza con un número (`workspace:*`, una URL, `latest`). */
function numerosDeVersion(rango: string): number[] | null {
  const match = /^[\^~>=v\s]*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(rango);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/**
 * ¿`tienda` pide una versión más vieja que `template`? Compara el piso de cada
 * rango (`^8.0.4` < `^9.0.1`). Ante cualquier cosa que no sea un número de
 * versión, `false`: no se pisa lo que no se entiende.
 */
export function versionMasVieja(tienda: string, template: string): boolean {
  const a = numerosDeVersion(tienda);
  const b = numerosDeVersion(template);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return false;
}

export function esTest(ruta: string): boolean {
  return ruta.startsWith('tests/') || /\.test\.tsx?$/.test(ruta);
}

/** ¿Hay algo que escribir? `al-dia`, `ignorar` y `conservar` no cambian nada. */
export function hayQueHacer(plan: readonly ArchivoPlan[]): boolean {
  return plan.some((archivo) => !['al-dia', 'ignorar', 'conservar'].includes(archivo.accion));
}

// ---------------------------------------------------------------------------
// De acá para abajo, git (y pnpm) de verdad.
// ---------------------------------------------------------------------------

export type ResultadoSync =
  | { estado: 'sin-cambios' }
  | { estado: 'precondicion'; mensaje: string }
  | { estado: 'dry-run'; objetivo: string; commits: Commit[]; plan: ArchivoPlan[] }
  | {
      estado: 'conflicto';
      objetivo: string;
      commits: Commit[];
      resumen: Resumen;
      commiteado: boolean;
      mensaje: string;
    }
  | { estado: 'fallo-post'; objetivo: string; commits: Commit[]; resumen: Resumen; mensaje: string }
  | { estado: 'completado'; objetivo: string; commits: Commit[]; resumen: Resumen };

function ramaActual(cwd: string): string {
  return gitEn(cwd, ['branch', '--show-current']).trim();
}

function ramaExiste(cwd: string, rama: string): boolean {
  try {
    gitEn(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${rama}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * `--rama-destino`: crea (o retoma) la rama pedida antes de sincronizar. El
 * workflow clona la tienda parada en su default branch; sin esto necesitaría
 * un `git checkout -b` aparte.
 */
function pararEnRamaDestino(cwd: string, rama: string): void {
  if (ramaActual(cwd) === rama) return;
  if (ramaExiste(cwd, rama)) {
    gitEn(cwd, ['checkout', rama]);
  } else {
    gitEn(cwd, ['checkout', '-b', rama]);
  }
}

function treeSucio(cwd: string): boolean {
  return gitEn(cwd, ['status', '--porcelain']).trim() !== '';
}

/**
 * Salida de git con `-z`: rutas separadas por NUL, sin citar. Sin `-z`, git
 * cita las rutas con caracteres no ASCII (`"src/app/categor\303\255a/…"`), y
 * esa ruta no aparece en los mapas de blobs (armados con `ls-tree -z`): el
 * archivo quedaba como "al día" y nunca viajaba.
 */
function rutasZ(salida: string): string[] {
  return salida.split('\0').filter((ruta) => ruta !== '');
}

/** ruta → blob, de un árbol entero. Un par de cientos de archivos: una sola llamada a git. */
function blobsDe(cwd: string, arbol: string): Map<string, string> {
  const blobs = new Map<string, string>();
  const salida = gitEn(cwd, ['ls-tree', '-r', '-z', '--full-tree', arbol]);
  for (const entrada of salida.split('\0')) {
    if (entrada === '') continue;
    // "<modo> <tipo> <blob>\t<ruta>"
    const tab = entrada.indexOf('\t');
    const [, tipo, blob] = entrada.slice(0, tab).split(' ');
    if (tipo === 'blob' && blob) blobs.set(entrada.slice(tab + 1), blob);
  }
  return blobs;
}

function blobABuffer(cwd: string, blob: string): Buffer {
  return execFileSync('git', ['-C', cwd, 'cat-file', 'blob', blob], {
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * `git merge-file` sobre tres blobs. Devuelve el resultado (con marcadores si
 * chocó) y cuántos conflictos quedaron; `null` si git no puede (binarios).
 */
function fusionar(cwd: string, ruta: string, v: Versiones): { contenido: Buffer; conflictos: number } | null {
  const tmp = mkdtempSync(join(tmpdir(), 'template-sync-'));
  try {
    const escribirLado = (nombre: string, blob: string | null): string => {
      const archivo = join(tmp, nombre);
      writeFileSync(archivo, blob ? blobABuffer(cwd, blob) : Buffer.alloc(0));
      return archivo;
    };
    const tienda = escribirLado('tienda', v.tienda);
    const base = escribirLado('base', v.base);
    const template = escribirLado('template', v.template);
    const args = ['merge-file', '-p', '-L', `${ruta} (tienda)`, '-L', `${ruta} (template, baseline)`, '-L', `${ruta} (template)`, tienda, base, template];
    try {
      const contenido = execFileSync('git', args, { maxBuffer: 50 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      return { contenido, conflictos: 0 };
    } catch (error) {
      const fallo = error as { status?: number | null; stdout?: Buffer };
      // merge-file sale con la cantidad de conflictos (>0) y el resultado en
      // stdout; un código negativo (255 en el proceso) es un error de verdad.
      if (typeof fallo.status === 'number' && fallo.status > 0 && fallo.status < 128 && fallo.stdout) {
        return { contenido: fallo.stdout, conflictos: fallo.status };
      }
      return null;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function tomarDelTemplate(cwd: string, objetivo: string, ruta: string, existeEnTemplate: boolean): void {
  if (existeEnTemplate) {
    gitEn(cwd, ['checkout', objetivo, '--', ruta]);
  } else {
    gitEn(cwd, ['rm', '-q', '--', ruta]);
  }
}

/**
 * Lo de `SOLO_TEMPLATE` que está versionado en la tienda: en una tienda vieja,
 * creada antes de que existiera la lista, también se saca lo que heredó.
 */
function soloTemplateVersionado(cwd: string): string[] {
  const rutas = SOLO_TEMPLATE.map((entrada) => entrada.replace(/\/$/, ''));
  return rutasZ(gitEn(cwd, ['ls-files', '-z', '--', ...rutas]));
}

function mensajeDeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const conSalida = error as { stderr?: unknown; message?: unknown };
    const stderr =
      typeof conSalida.stderr === 'string'
        ? conSalida.stderr
        : conSalida.stderr instanceof Buffer
          ? conSalida.stderr.toString('utf8')
          : '';
    if (stderr.trim() !== '') return stderr.trim();
    if (typeof conSalida.message === 'string') return conSalida.message;
  }
  return String(error);
}

/** Cuerpo del commit: qué commits de maquinaria del template quedaron adentro. */
function mensajeCommit(objetivo: string, commits: Commit[], conflictos: Conflicto[]): string {
  const titulo = `Sincronizar maquinaria del template hasta ${objetivo.slice(0, 12)}`;
  const partes = [conflictos.length > 0 ? `${titulo} (con conflictos)` : titulo, ''];
  if (conflictos.length > 0) {
    partes.push('Conflictos a resolver a mano:', ...conflictos.map((c) => `- ${c.ruta}: ${c.motivo}`), '');
  }
  const deMaquinaria = commits.filter((commit) => commit.maquinaria);
  if (deMaquinaria.length > 0) {
    partes.push('Commits de maquinaria del template incluidos:', ...deMaquinaria.map((c) => `- ${c.sha.slice(0, 12)} ${c.asunto}`));
  }
  return partes.join('\n');
}

/**
 * El corazón del comando. Nada de esto imprime a consola ni llama a
 * `process.exit`: eso es cosa de `main()`, para que esta función se pueda
 * llamar directo desde un test de integración contra un repo temporal.
 */
export function ejecutarSync(cwd: string, opciones: Opciones): ResultadoSync {
  if (opciones.ramaDestino) {
    pararEnRamaDestino(cwd, opciones.ramaDestino);
  }

  if (ramaActual(cwd) === 'main') {
    return {
      estado: 'precondicion',
      mensaje:
        'Estás parado en "main". `template:sync` deja un commit con la maquinaria nueva: ' +
        'creá o cambiá a una rama de feature y volvé a correrlo ahí.',
    };
  }

  if (treeSucio(cwd)) {
    return {
      estado: 'precondicion',
      mensaje:
        'El working tree tiene cambios sin commitear. Commiteá o guardalos antes de sincronizar.\n\n' +
        '  Si son los conflictos de una corrida anterior: resolvé los marcadores, `git add -A`\n' +
        '  y `git commit` — el baseline nuevo ya está en ese mismo commit.',
    };
  }

  if (!remotoExiste(cwd, opciones.remoto)) {
    gitEn(cwd, ['remote', 'add', opciones.remoto, URL_TEMPLATE]);
  }

  try {
    gitEn(cwd, ['fetch', opciones.remoto, opciones.rama]);
  } catch {
    return {
      estado: 'precondicion',
      mensaje: `No pude traer ${opciones.remoto}/${opciones.rama}. ¿Tenés acceso al repo del template?`,
    };
  }

  const ref = `${opciones.remoto}/${opciones.rama}`;

  if (!existsSync(join(cwd, BASELINE_FILE))) {
    return {
      estado: 'precondicion',
      mensaje:
        `No hay ${BASELINE_FILE} en este repo, así que no sé desde dónde traer.\n\n` +
        '  Marcá primero un punto de partida conocido: el commit del template desde el que\n' +
        '  se creó esta tienda (o hasta el que se sincronizó a mano por última vez):\n\n' +
        '    pnpm template:diff --marcar\n',
    };
  }

  const baseline = parseBaseline(readFileSync(join(cwd, BASELINE_FILE), 'utf8'));
  if (!baseline) {
    return {
      estado: 'precondicion',
      mensaje: `${BASELINE_FILE} existe pero no tiene un SHA válido. Corré \`pnpm template:diff --marcar\` para reescribirlo.`,
    };
  }

  let objetivo: string;
  try {
    gitEn(cwd, ['cat-file', '-e', `${baseline}^{commit}`]);
    objetivo = gitEn(cwd, ['rev-parse', '--verify', `${opciones.hasta ?? ref}^{commit}`]).trim();
    gitEn(cwd, ['merge-base', '--is-ancestor', baseline, objetivo]);
  } catch {
    return {
      estado: 'precondicion',
      mensaje: opciones.hasta
        ? `"${opciones.hasta}" no es un commit del template posterior al baseline (${baseline.slice(0, 12)}).`
        : `El baseline ${baseline.slice(0, 12)} no está en la historia de ${ref}. ¿Es un SHA del template?`,
    };
  }

  const commits = commitsClasificados(cwd, baseline, objetivo);
  const enBase = blobsDe(cwd, baseline);
  const enTienda = blobsDe(cwd, 'HEAD');
  const enObjetivo = blobsDe(cwd, objetivo);

  // Lo que el template cambió desde el baseline, archivo por archivo…
  const cambiados = rutasZ(
    gitEn(cwd, ['diff', '--name-only', '-z', '--no-renames', baseline, objetivo]),
  );
  const plan: ArchivoPlan[] = cambiados.map((ruta) => ({
    ruta,
    accion: decidirArchivo(ruta, {
      base: enBase.get(ruta) ?? null,
      tienda: enTienda.get(ruta) ?? null,
      template: enObjetivo.get(ruta) ?? null,
    }),
  }));

  // …más la maquinaria que le falta a la tienda aunque el template no la haya
  // tocado en el medio. Antes esto se salteaba ("el baseline dice que estoy al
  // día"), pero un baseline marcado a mano no prueba nada: la maquinaria viaja
  // junta, y un archivo que falta deja en rojo a los que sí llegan y lo
  // importan (ver `maquinariaFaltante`).
  const enElPlan = new Set(cambiados);
  for (const ruta of maquinariaFaltante(enObjetivo.keys(), (r) => enTienda.has(r))) {
    if (!enElPlan.has(ruta)) plan.push({ ruta, accion: 'restaurar' });
  }
  plan.sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));

  const soloTemplate = soloTemplateVersionado(cwd);

  if (!hayQueHacer(plan) && soloTemplate.length === 0) {
    return { estado: 'sin-cambios' };
  }

  if (opciones.dryRun) {
    return { estado: 'dry-run', objetivo, commits, plan };
  }

  const resumen = resumenVacio();
  const versiones = (ruta: string): Versiones => ({
    base: enBase.get(ruta) ?? null,
    tienda: enTienda.get(ruta) ?? null,
    template: enObjetivo.get(ruta) ?? null,
  });

  for (const { ruta, accion } of plan) {
    const v = versiones(ruta);

    switch (accion) {
      case 'tomar-template':
        tomarDelTemplate(cwd, objetivo, ruta, v.template !== null);
        (v.template === null ? resumen.borrados : resumen.traidos).push(ruta);
        break;
      case 'restaurar':
        tomarDelTemplate(cwd, objetivo, ruta, true);
        resumen.restaurados.push(ruta);
        break;
      case 'conflicto':
        resumen.conflictos.push({
          ruta,
          motivo: 'el template lo borró y la tienda lo tiene cambiado: borralo o quedátelo a mano',
        });
        break;
      case 'conservar':
        if (v.template === null && v.tienda !== null) {
          resumen.huerfanos.push(ruta);
          break;
        }
        resumen.conservados.push(ruta);
        if (esMixto(ruta)) resumen.mixtos.push(ruta);
        break;
      case 'fusionar': {
        if (esTest(ruta) && v.template !== null) {
          // Un test va con la maquinaria que prueba: si la tienda lo adaptó y el
          // template también lo cambió, gana el del template (y se lista). Un
          // merge "limpio" de dos tests distintos compila mal más seguido que
          // bien (imports de un lado, uso del otro).
          tomarDelTemplate(cwd, objetivo, ruta, true);
          resumen.reemplazados.push(ruta);
          break;
        }
        if (ruta === 'package.json' && v.base !== null && v.tienda !== null && v.template !== null) {
          const json = fusionarPackageJson(
            blobABuffer(cwd, v.base).toString('utf8'),
            blobABuffer(cwd, v.tienda).toString('utf8'),
            blobABuffer(cwd, v.template).toString('utf8'),
          );
          if (json) {
            writeFileSync(join(cwd, ruta), json.contenido);
            gitEn(cwd, ['add', '--', ruta]);
            resumen.fusionados.push(ruta);
            resumen.reemplazados.push(...json.pisadas.map((clave) => `package.json → ${clave}`));
            break;
          }
        }
        const resultado = fusionar(cwd, ruta, v);
        if (!resultado) {
          resumen.conflictos.push({
            ruta,
            motivo: 'cambiado en la tienda y en el template, y git no lo puede fusionar (¿binario?)',
          });
          break;
        }
        writeFileSync(join(cwd, ruta), resultado.contenido);
        if (resultado.conflictos > 0) {
          resumen.conflictos.push({
            ruta,
            motivo: `${resultado.conflictos} bloque(s) con marcadores <<<<<<< — la tienda y el template cambiaron lo mismo`,
          });
        } else {
          gitEn(cwd, ['add', '--', ruta]);
          resumen.fusionados.push(ruta);
        }
        break;
      }
      default:
        break;
    }
  }

  // El lockfile, al final: depende de cómo quedó package.json.
  if (plan.some((archivo) => archivo.accion === 'lockfile')) {
    const lock = versiones('pnpm-lock.yaml');
    const paqueteFinal = gitEn(cwd, ['hash-object', '--', 'package.json']).trim();
    const paqueteTemplate = enObjetivo.get('package.json') ?? null;

    if (resumen.conflictos.some((c) => c.ruta === 'package.json')) {
      resumen.conflictos.push({
        ruta: 'pnpm-lock.yaml',
        motivo: 'resolvé package.json primero y después `pnpm install` para regenerarlo',
      });
    } else if (lock.tienda === lock.base && paqueteFinal === paqueteTemplate) {
      // Mismas dependencias que el template: su lockfile es exactamente el correcto.
      tomarDelTemplate(cwd, objetivo, 'pnpm-lock.yaml', lock.template !== null);
      resumen.traidos.push('pnpm-lock.yaml');
    } else {
      try {
        execFileSync('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        gitEn(cwd, ['add', '--', 'pnpm-lock.yaml']);
        resumen.fusionados.push('pnpm-lock.yaml');
      } catch (error) {
        resumen.conflictos.push({
          ruta: 'pnpm-lock.yaml',
          motivo: `\`pnpm install --lockfile-only\` falló: ${mensajeDeError(error).split('\n')[0]}`,
        });
      }
    }
  }

  writeFileSync(join(cwd, BASELINE_FILE), contenidoBaseline(objetivo));
  gitEn(cwd, ['add', '--', BASELINE_FILE]);
  if (soloTemplate.length > 0) gitEn(cwd, ['rm', '-r', '-q', '--', ...soloTemplate]);

  if (resumen.conflictos.length > 0) {
    const commiteado = Boolean(opciones.commitearConflictos);
    if (commiteado) {
      gitEn(cwd, ['add', '-A']);
      gitEn(cwd, ['-c', 'core.editor=true', 'commit', '-m', mensajeCommit(objetivo, commits, resumen.conflictos)]);
    }
    return {
      estado: 'conflicto',
      objetivo,
      commits,
      resumen,
      commiteado,
      mensaje:
        `${resumen.conflictos.length} archivo(s) que no puedo resolver solo:\n\n` +
        resumen.conflictos.map((c) => `    - ${c.ruta}: ${c.motivo}`).join('\n') +
        (commiteado
          ? '\n\n  Quedaron commiteados así (con marcadores): resolvelos en esta rama antes de mergear.\n'
          : '\n\n  Lo demás ya está aplicado (y el baseline nuevo escrito). Para terminar:\n\n' +
            '    1. Editá esos archivos y sacá los marcadores de conflicto\n' +
            '    2. git add -A\n' +
            '    3. git commit -m "Sincronizar maquinaria del template"\n'),
    };
  }

  gitEn(cwd, ['-c', 'core.editor=true', 'commit', '-m', mensajeCommit(objetivo, commits, [])]);

  if (!opciones.sinTests) {
    const pasos: string[][] = [];
    if (plan.some((archivo) => archivo.ruta === 'package.json' || archivo.ruta === 'pnpm-lock.yaml')) {
      pasos.push(['pnpm', 'install']);
    }
    pasos.push(['pnpm', 'typecheck'], ['pnpm', 'lint'], ['pnpm', 'test']);
    for (const comando of pasos) {
      try {
        execFileSync(comando[0]!, comando.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        return {
          estado: 'fallo-post',
          objetivo,
          commits,
          resumen,
          mensaje: `\`${comando.join(' ')}\` falló después de traer la maquinaria:\n\n${mensajeDeError(error)}`,
        };
      }
    }
  }

  return { estado: 'completado', objetivo, commits, resumen };
}

/**
 * Resumen máquina de un `ResultadoSync`, para `--json`.
 *
 * Pura a propósito (nada de git acá): así el test unitario fija la forma sin
 * tener que armar un repo de verdad. `distribuir.yml` (vía
 * `scripts/ci/armar-pr-tiendas.mjs`) lo lee para armar el cuerpo del PR y
 * decidir si sale en draft (`conflicto`).
 */
export function resumenJson(resultado: ResultadoSync): Record<string, unknown> {
  const commit = (c: Commit) => ({ sha: c.sha, asunto: c.asunto });
  const deMaquinaria = (commits: Commit[]) => commits.filter((c) => c.maquinaria).map(commit);

  switch (resultado.estado) {
    case 'sin-cambios':
      return { estado: 'sin-cambios' };
    case 'precondicion':
      return { estado: 'precondicion', mensaje: resultado.mensaje };
    case 'dry-run':
      return {
        estado: 'dry-run',
        objetivo: resultado.objetivo,
        commits: deMaquinaria(resultado.commits),
        plan: resultado.plan,
      };
    case 'conflicto':
      return {
        estado: 'conflicto',
        objetivo: resultado.objetivo,
        commits: deMaquinaria(resultado.commits),
        resumen: resultado.resumen,
        commiteado: resultado.commiteado,
        mensaje: resultado.mensaje,
      };
    case 'fallo-post':
      return {
        estado: 'fallo-post',
        objetivo: resultado.objetivo,
        commits: deMaquinaria(resultado.commits),
        resumen: resultado.resumen,
        mensaje: resultado.mensaje,
      };
    case 'completado':
      return {
        estado: 'completado',
        objetivo: resultado.objetivo,
        commits: deMaquinaria(resultado.commits),
        resumen: resultado.resumen,
      };
    default:
      return { estado: 'desconocido' };
  }
}

const ETIQUETAS: Array<[keyof Omit<Resumen, 'conflictos'>, string]> = [
  ['traidos', 'traídos del template'],
  ['borrados', 'borrados (el template los sacó)'],
  ['restaurados', 'maquinaria que faltaba, restaurada'],
  ['fusionados', 'fusionados solos (cambios de los dos lados)'],
  ['reemplazados', 'cambios tuyos que pisó el template (tests, claves de package.json)'],
  ['conservados', 'tuyos, sin tocar (piel o docs que cambiaste)'],
  ['huerfanos', 'piel tuya que el template borró o renombró: ya no se usa, pasá tu diseño al archivo nuevo'],
  ['mixtos', 'mixtos: el template cambió su lógica, miralos a mano'],
];

function imprimirResumen(resumen: Resumen): void {
  for (const [clave, etiqueta] of ETIQUETAS) {
    const rutas = resumen[clave];
    if (rutas.length === 0) continue;
    console.log(`\n  ${rutas.length} ${etiqueta}:`);
    for (const ruta of rutas) console.log(`    ${ruta}`);
  }
}

function main(): void {
  let opciones: Opciones;
  try {
    opciones = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    console.error(
      '\n  pnpm template:sync [--dry-run] [--hasta <sha>] [--sin-tests] ' +
        '[--rama-destino <nombre>] [--json] [--commitear-conflictos]\n',
    );
    process.exitCode = 1;
    return;
  }

  const resultado = ejecutarSync(process.cwd(), opciones);

  if (opciones.json) {
    console.log(JSON.stringify(resumenJson(resultado)));
    if (resultado.estado === 'precondicion' || resultado.estado === 'conflicto' || resultado.estado === 'fallo-post') {
      process.exitCode = 1;
    }
    return;
  }

  switch (resultado.estado) {
    case 'precondicion':
      console.error(`\n✗ ${resultado.mensaje}\n`);
      process.exitCode = 1;
      return;
    case 'sin-cambios':
      console.log('\n✓ No hay maquinaria pendiente del template.\n');
      return;
    case 'dry-run': {
      console.log(`\n(dry-run) hasta ${resultado.objetivo.slice(0, 12)} del template, archivo por archivo:\n`);
      for (const { ruta, accion } of resultado.plan) {
        if (accion === 'al-dia' || accion === 'ignorar') continue;
        console.log(`    ${accion.padEnd(15)} ${ruta}`);
      }
      console.log('\nSacá --dry-run para aplicarlo de verdad.\n');
      return;
    }
    case 'conflicto':
      imprimirResumen(resultado.resumen);
      console.error(`\n✗ ${resultado.mensaje}\n`);
      process.exitCode = 1;
      return;
    case 'fallo-post':
      imprimirResumen(resultado.resumen);
      console.error(
        `\n✗ ${resultado.mensaje}\n\n` +
          '  El commit de la sincronización quedó hecho: arreglá lo que falló en un commit aparte.\n',
      );
      process.exitCode = 1;
      return;
    case 'completado':
      imprimirResumen(resultado.resumen);
      console.log(
        `\n✓ Maquinaria sincronizada hasta ${resultado.objetivo.slice(0, 12)}.\n` +
          `  ${BASELINE_FILE} actualizado, todo en un commit.\n`,
      );
      return;
    default:
      return;
  }
}

if (process.argv[1] && /template-sync\.ts$/.test(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
