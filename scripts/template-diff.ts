import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  BASELINE_FILE,
  clasificar,
  commitDeOrigen,
  commitsClasificados,
  contenidoBaseline,
  gitEn,
  MAQUINARIA,
  maquinariaFaltante,
  MIXTOS,
  parseBaseline,
  parseCommits,
  remotoExiste,
  rutasEn,
} from './template-shared';

/**
 * `pnpm template:diff` — ¿qué arreglos del template le faltan a esta tienda?
 *
 * Los repos creados con "Use this template" no reciben **solos** los commits
 * posteriores del template: les llegan como PR `template/sync` cuando se
 * publica una versión (`distribuir.yml`), o a mano con `pnpm template:sync`.
 * Esto dice qué les falta mientras tanto.
 *
 * El problema para calcular eso: un repo hecho desde un template **no comparte
 * historia** con el original — arranca de un commit inicial propio. O sea que
 * `git log HEAD..template/main` no sirve: sin ancestro común, lista todo.
 *
 * Por eso hay un archivo `.template-baseline` con el SHA del template hasta
 * donde esta tienda está al día. Con ese punto de partida, "qué falta" vuelve a
 * ser una resta:
 *
 *   pnpm template:diff              # qué commits del template no están acá
 *   pnpm template:diff --marcar     # "ya me puse al día": guarda el SHA actual
 *   pnpm template:diff --marcar --origen  # el commit del que salió la tienda
 *   pnpm template:diff --marcar --forzar  # marcar aunque falte maquinaria (no lo hagas)
 *
 * Además de la resta, lista la maquinaria del template que esta tienda no
 * tiene (`maquinariaFaltante`), y `--marcar` se niega mientras falte algo:
 * marcar "al día" con archivos de menos es exactamente cómo esos archivos
 * dejaban de aparecer para siempre.
 *
 * Sin baseline todavía, igual sirve: compara los archivos de la maquinaria
 * contra el template y te dice cuáles difieren.
 *
 * Traerlo es `pnpm template:sync` (`template-sync.ts`), archivo por archivo
 * desde el mismo baseline (ver `template-shared.ts`).
 */

// Re-exportado tal cual para que nada de afuera (tests incluidos) tenga que
// saber que esto ahora vive en template-shared.ts.
export { BASELINE_FILE, clasificar, contenidoBaseline, MAQUINARIA, MIXTOS, parseBaseline, parseCommits };

export type Opciones = {
  remoto: string;
  rama: string;
  marcar: boolean;
  /** Con `--marcar`: el commit del que salió la tienda, no la punta del template. */
  origen: boolean;
  /** Con `--marcar`: marcar aunque falte maquinaria. */
  forzar: boolean;
};

export function parseArgs(argv: string[]): Opciones {
  const opciones: Opciones = {
    remoto: 'template',
    rama: 'main',
    marcar: false,
    origen: false,
    forzar: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];

    if (flag === '--marcar') {
      opciones.marcar = true;
      continue;
    }
    if (flag === '--origen') {
      opciones.origen = true;
      continue;
    }
    if (flag === '--forzar') {
      opciones.forzar = true;
      continue;
    }
    if (flag === '--remoto' || flag === '--rama') {
      const valor = argv[i + 1];
      if (!valor || valor.startsWith('--')) throw new Error(`${flag} espera un valor`);
      if (flag === '--remoto') opciones.remoto = valor;
      else opciones.rama = valor;
      i += 1;
      continue;
    }

    throw new Error(`no conozco la opción "${flag}"`);
  }

  return opciones;
}

function git(...args: string[]): string {
  return gitEn(process.cwd(), args);
}

function main(): void {
  const opciones = parseArgs(process.argv.slice(2));
  const ref = `${opciones.remoto}/${opciones.rama}`;

  if (!remotoExiste(process.cwd(), opciones.remoto)) {
    console.error(
      `\n✗ No hay un remoto "${opciones.remoto}". Agregalo una vez y listo:\n\n` +
        `    git remote add ${opciones.remoto} https://github.com/antonmarklundcom/ecom.git\n\n` +
        'Si esto ES el repo del template, no hay nada que comparar.\n',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nBuscando novedades en ${ref}…`);
  try {
    git('fetch', opciones.remoto, opciones.rama);
  } catch {
    console.error(`✗ No pude traer ${ref}. ¿Tenés acceso al repo del template?`);
    process.exitCode = 1;
    return;
  }

  const cabezaTemplate = git('rev-parse', ref).trim();
  const enLaTienda = new Set(rutasEn(process.cwd(), 'HEAD'));
  // Contra el commit que corresponde: la punta del template para el reporte,
  // el commit que se va a marcar para `--marcar` (con `--origen`, el de la
  // creación de la tienda: lo que el template sumó después no le falta).
  const faltantesContra = (commit: string): string[] =>
    maquinariaFaltante(rutasEn(process.cwd(), commit), (ruta) => enLaTienda.has(ruta));
  if (opciones.marcar) {
    const marca = opciones.origen ? commitDeOrigen(process.cwd(), ref) : cabezaTemplate;
    if (!marca) {
      console.error(
        `\n✗ Ningún commit de ${ref} tiene el árbol del primer commit de esta tienda.\n` +
          '  Pasa con un repo que ya existía (bootstrap:repo). Buscá a mano de qué commit\n' +
          `  del template salió y escribilo en ${BASELINE_FILE}.\n`,
      );
      process.exitCode = 1;
      return;
    }
    const faltanAlMarcar = faltantesContra(marca);
    if (faltanAlMarcar.length > 0 && !opciones.forzar) {
      console.error(
        `\n✗ No marco: a esta tienda le falta${faltanAlMarcar.length === 1 ? '' : 'n'} ${faltanAlMarcar.length} archivo(s) de maquinaria del template:\n`,
      );
      listarFaltantes(faltanAlMarcar, console.error);
      console.error(
        '\n  Marcar ahora los daría por traídos y no volverían a aparecer. Traelos con\n' +
          '  `pnpm template:sync` (en una rama) y marcá después. Si de verdad querés\n' +
          '  marcar igual: `pnpm template:diff --marcar --forzar`.\n',
      );
      process.exitCode = 1;
      return;
    }
    writeFileSync(BASELINE_FILE, contenidoBaseline(marca));
    console.log(
      `\n✓ ${BASELINE_FILE} apunta a ${marca.slice(0, 12)}.\n` +
        '  Commiteá ese archivo: es lo que hace que la próxima corrida sepa desde dónde mirar.\n',
    );
    return;
  }

  const baseline = existsSync(BASELINE_FILE)
    ? parseBaseline(readFileSync(BASELINE_FILE, 'utf8'))
    : null;

  if (!baseline) {
    sinBaseline(ref);
    return;
  }

  const commits = commitsClasificados(process.cwd(), baseline, ref);

  const faltan = faltantesContra(cabezaTemplate);
  if (faltan.length > 0) {
    console.log(`\n! Falta${faltan.length === 1 ? '' : 'n'} ${faltan.length} archivo(s) de maquinaria del template en esta tienda:\n`);
    listarFaltantes(faltan);
    console.log('\n  `pnpm template:sync` (en una rama) los trae aunque el template no los haya cambiado.');
  }

  if (commits.length === 0) {
    if (faltan.length === 0) console.log('\n✓ Esta tienda está al día con el template.\n');
    else console.log('\n  Commits nuevos del template: ninguno.\n');
    return;
  }

  const deMaquinaria = commits.filter((commit) => commit.maquinaria);
  const mixtos = commits.filter((commit) => commit.mixto);

  console.log(`\n${commits.length} commit(s) del template que no están acá:\n`);
  for (const commit of commits) {
    // El asterisco es el que te dice cuáles mirar primero.
    const marca = commit.maquinaria ? '*' : commit.mixto ? '~' : ' ';
    console.log(`  ${marca} ${commit.sha.slice(0, 12)}  ${commit.asunto}`);
  }

  console.log(
    `\n  * = toca la maquinaria (${MAQUINARIA.join(', ')}): son los que toda tienda quiere.\n` +
      '      El resto suele ser piel —copy, diseño— que cada tienda reescribió a su gusto:\n' +
      '      template:sync la deja como la tenés.\n',
  );

  if (mixtos.length > 0) {
    console.log(
      `  ~ = toca ${MIXTOS.join(', ')}: markup tuyo con lógica compartida adentro.\n` +
        '      template:sync no los pisa si los cambiaste, pero leé el diff:\n' +
        '      si lo que cambió es la lógica, te falta.\n',
    );
  }

  if (deMaquinaria.length > 0) {
    console.log(
      '  Para traerlos, en una rama (nunca en main):\n\n' +
        '      pnpm template:sync --dry-run   # qué haría con cada archivo\n' +
        '      pnpm template:sync\n\n' +
        '  (archivo por archivo, en un commit: la piel que cambiaste queda, la maquinaria\n' +
        '  se fusiona, y un choque de verdad deja marcadores para que lo mires vos.)\n',
    );
  }

  console.log(
    'Si decidís saltearlos a propósito (template:sync ya lo mueve solo):\n\n' +
      '    pnpm template:diff --marcar\n\n' +
      'Sin eso, los mismos commits vuelven a aparecer la próxima vez.\n',
  );
}

function listarFaltantes(faltan: readonly string[], imprimir: (linea: string) => void = console.log): void {
  const MOSTRAR = 30;
  for (const ruta of faltan.slice(0, MOSTRAR)) imprimir(`    ${ruta}`);
  if (faltan.length > MOSTRAR) imprimir(`    … y ${faltan.length - MOSTRAR} más`);
}

function sinBaseline(ref: string): void {
  console.log(
    `\nTodavía no hay ${BASELINE_FILE}, así que no puedo hacer la resta:\n` +
      'un repo creado con "Use this template" no comparte historia con el original,\n' +
      'y sin un punto de partida "qué falta" sería la lista entera.\n',
  );

  const difieren = (...rutas: readonly string[]): string[] =>
    git('diff', '--name-only', `HEAD..${ref}`, '--', ...rutas)
      .split('\n')
      .filter((linea) => linea.trim() !== '');

  const cambiados = difieren(...MAQUINARIA);

  if (cambiados.length === 0) {
    console.log('Mientras tanto: la maquinaria es idéntica a la del template. Buena señal.\n');
  } else {
    console.log(`Mientras tanto, ${cambiados.length} archivo(s) de la maquinaria difieren:\n`);
    for (const archivo of cambiados) console.log(`    ${archivo}`);
    console.log(`\n  Miralos con:  git diff HEAD..${ref} -- <archivo>\n`);
  }

  const aMano = difieren(...MIXTOS);
  if (aMano.length > 0) {
    console.log(
      'Y aparte, markup tuyo con lógica compartida adentro (leé el diff, no lo pises):\n',
    );
    for (const archivo of aMano) console.log(`    ${archivo}`);
    console.log('');
  }

  console.log(
    'Para que la próxima corrida sirva de verdad, fijá el punto de partida:\n\n' +
      '    pnpm template:diff --marcar\n\n' +
      'Marca "estoy al día con el template de hoy". A partir de ahí te lista sólo lo nuevo.\n',
  );
}

// Igual que el resto de los scripts: los tests importan las funciones puras de
// acá arriba sin correr un solo comando de git.
if (process.argv[1] && /template-diff\.ts$/.test(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
