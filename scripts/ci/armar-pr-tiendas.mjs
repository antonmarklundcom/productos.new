#!/usr/bin/env node
// Sólo lo usa `.github/workflows/distribuir.yml`, corriendo dentro del
// checkout recién clonado de la tienda, con `GH_TOKEN` puesto a
// `secrets.TIENDAS_TOKEN` (así `gh` opera sobre el repo de la tienda, no sobre
// este). No es parte del CLI de `template:sync` — sólo traduce su salida
// `--json` en un push + PR (o en nada, o en un error legible).
//
// Uso: node armar-pr-tiendas.mjs --repo owner/tienda --rama template/sync \
//        --base main --resultado sync-resultado.json --sha <sha-del-template> \
//        [--version v1.2.0] [--email-bot actions@users.noreply.github.com]
//
// Una sola rama por tienda (`template/sync`): cada versión nueva reescribe la
// misma rama y actualiza el mismo PR, en vez de apilar un PR por corrida.
// Si alguien ya empujó commits a mano a esa rama (resolviendo un conflicto)
// y su PR sigue abierto, no se pisan: se avisa y se sale.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function args() {
  const argv = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const clave = argv[i]?.replace(/^--/, '');
    out[clave] = argv[i + 1];
  }
  return out;
}

function sh(cmd, cmdArgs, opciones = {}) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opciones });
}

function lista(rutas) {
  return rutas.map((ruta) => `- \`${ruta}\``).join('\n');
}

function commitLista(commits) {
  if (!commits || commits.length === 0) return '_(ninguno de maquinaria)_';
  return commits.map((c) => `- \`${c.sha.slice(0, 12)}\` ${c.asunto}`).join('\n');
}

/** Secciones del cuerpo del PR, sólo las que tienen algo. */
function seccionesResumen(resumen) {
  const partes = [];
  const agregar = (titulo, rutas) => {
    if (rutas && rutas.length > 0) partes.push('', `**${titulo}** (${rutas.length})`, '', lista(rutas));
  };
  if (resumen.conflictos?.length > 0) {
    partes.push(
      '',
      `**⚠ Conflictos a resolver en esta rama antes de mergear** (${resumen.conflictos.length})`,
      '',
      ...resumen.conflictos.map((c) => `- \`${c.ruta}\` — ${c.motivo}`),
    );
  }
  agregar('Cambios de esta tienda que pisó el template — revisalos', resumen.reemplazados);
  agregar('Mixtos: el template cambió su lógica y esta tienda los tiene distintos — miralos a mano', resumen.mixtos);
  agregar('Maquinaria que faltaba en esta tienda, restaurada', resumen.restaurados);
  agregar('Fusionados solos (cambios de los dos lados)', resumen.fusionados);
  agregar('Traídos del template', resumen.traidos);
  agregar('Borrados (el template los sacó)', resumen.borrados);
  agregar(
    '⚠ Piel de esta tienda que el template borró o renombró — ya no se usa: pasá el diseño al archivo nuevo',
    resumen.huerfanos,
  );
  agregar('Piel o docs de esta tienda que no se tocaron', resumen.conservados);
  return partes;
}

/**
 * ¿La rama remota tiene commits que no hizo el bot? Entonces alguien trabajó
 * ahí. Los merge commits no cuentan: "Update branch" de GitHub sólo trae la
 * base, y la corrida nueva ya arranca de la base.
 */
function commitsAMano(base, rama, emailBot) {
  try {
    sh('git', ['fetch', 'origin', rama]);
  } catch {
    return []; // la rama no existe todavía
  }
  const autores = sh('git', ['log', '--no-merges', '--format=%h %ae %s', `origin/${base}..origin/${rama}`])
    .split('\n')
    .filter((linea) => linea.trim() !== '');
  return autores.filter((linea) => linea.split(' ')[1] !== emailBot);
}

/** El PR abierto de esa rama en la tienda, o `null`. */
function prAbierto(repo, rama) {
  try {
    const salida = sh('gh', ['pr', 'list', '-R', repo, '--head', rama, '--state', 'open', '--json', 'number,isDraft']);
    return JSON.parse(salida)[0] ?? null;
  } catch {
    return null;
  }
}

function main() {
  const {
    repo,
    rama,
    base = 'main',
    resultado: rutaResultado,
    sha,
    version,
    'email-bot': emailBot = 'actions@users.noreply.github.com',
  } = args();
  if (!repo || !rama || !rutaResultado) {
    console.error(
      'Uso: armar-pr-tiendas.mjs --repo owner/tienda --rama <rama> --base <rama-base> --resultado <archivo.json> --sha <sha>',
    );
    process.exit(1);
  }

  let resultado;
  try {
    resultado = JSON.parse(readFileSync(rutaResultado, 'utf8'));
  } catch (error) {
    console.error(`No pude leer/parsear ${rutaResultado} (¿template:sync no imprimió JSON válido?): ${error.message}`);
    process.exit(1);
  }

  if (resultado.estado === 'sin-cambios') {
    console.log('✓ Esta tienda ya está al día con el template — no hay nada que empujar.');
    return;
  }

  if (resultado.estado === 'precondicion' || !resultado.resumen) {
    console.error(`✗ template:sync no pudo arrancar en esta tienda: ${resultado.mensaje ?? JSON.stringify(resultado)}`);
    process.exit(1);
  }

  const conflicto = resultado.estado === 'conflicto';
  if (conflicto && !resultado.commiteado) {
    console.error('✗ template:sync dejó conflictos sin commitear (¿falta --commitear-conflictos en el workflow?).');
    process.exit(1);
  }

  const existente = prAbierto(repo, rama);

  // Los commits a mano sólo se cuidan mientras su PR sigue abierto. Un PR
  // cerrado, o mergeado con squash, deja la rama con commits ajenos que nunca
  // van a ser ancestros de la base: sin esto, esa tienda no volvía a recibir
  // ninguna versión y el job igual terminaba en verde.
  const aMano = existente ? commitsAMano(base, rama, emailBot) : [];
  if (aMano.length > 0) {
    console.log(
      `::warning::${repo}: el PR #${existente.number} (rama ${rama}) tiene commits hechos a mano que no voy a pisar:\n` +
        aMano.map((linea) => `    ${linea}`).join('\n') +
        `\nMergealo o cerralo y volvé a correr la distribución para traer lo nuevo.`,
    );
    return;
  }

  // `--force`: la rama es del bot, o su PR ya no está abierto (lo acabamos de
  // comprobar), y cada corrida la
  // rearma entera desde la default branch de la tienda.
  sh('git', ['push', '--force', 'origin', `HEAD:refs/heads/${rama}`]);

  // El label que habilita el e2e en el CI de la tienda (ci.yml). Crearlo es
  // idempotente con --force; sin permiso para labels, no frena nada.
  try {
    sh('gh', ['label', 'create', 'ci-completo', '-R', repo, '--force', '--color', '0E8A16', '--description', 'Corre también e2e (Playwright) en el CI']);
  } catch {
    // sin permiso de issues:write; el PR sale igual
  }

  const cabeza = sha ? sha.slice(0, 12) : '?';
  const titulo = `Actualizar maquinaria del template${version ? ` a ${version}` : ''}`;
  const cuerpo = [
    `Trae la maquinaria de [antonmarklundcom/ecom](https://github.com/antonmarklundcom/ecom)` +
      `${version ? ` **${version}**` : ''} (\`${cabeza}\`), archivo por archivo desde el \`.template-baseline\` de esta tienda.` +
      ' Qué cambió en cada versión: `CHANGELOG.md`. Si alguna trae **Migración: sí**, después de mergear hay que redeployar y correr el setup (NEW-STORE.md § "Migraciones que llegan por `template:sync`").',
    ...seccionesResumen(resultado.resumen),
    '',
    '<details><summary>Commits de maquinaria del template incluidos</summary>',
    '',
    commitLista(resultado.commits),
    '',
    '</details>',
    '',
    '---',
    `Generado por \`distribuir.yml\` en \`antonmarklundcom/ecom@${cabeza}\` — \`pnpm template:sync\` corrió con \`--sin-tests\`: ` +
      'el CI de esta tienda es el que decide si se mergea. Para seguir a mano: `git fetch origin && git checkout ' +
      `${rama}\`, resolver, commitear y pushear a esta misma rama (la próxima distribución no la pisa mientras tenga commits tuyos).`,
  ].join('\n');

  if (existente) {
    sh('gh', ['pr', 'edit', String(existente.number), '-R', repo, '--title', titulo, '--body', cuerpo]);
    try {
      if (conflicto && !existente.isDraft) sh('gh', ['pr', 'ready', String(existente.number), '-R', repo, '--undo']);
      if (!conflicto && existente.isDraft) sh('gh', ['pr', 'ready', String(existente.number), '-R', repo]);
    } catch {
      // cambiar draft/ready no es lo importante
    }
    console.log(`✓ PR #${existente.number} actualizado en ${repo} (rama ${rama}).`);
    return;
  }

  const crearArgs = ['pr', 'create', '-R', repo, '--head', rama, '--base', base, '--title', titulo, '--body', cuerpo];
  if (conflicto) crearArgs.push('--draft');
  const salida = sh('gh', crearArgs);
  console.log(salida.trim());
}

main();
