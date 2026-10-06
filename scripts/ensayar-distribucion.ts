import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitEn } from './template-shared';
import { ejecutarSync, type ResultadoSync } from './template-sync';

/**
 * `pnpm template:ensayar-distribucion` — lo que haría `distribuir.yml` con
 * cada tienda, sin empujar nada y sin gastar minutos de Actions.
 *
 * Clona cada tienda de `tiendas.json` en una carpeta temporal, le corre
 * `template:sync` desde **esta** rama del template (igual que el workflow, que
 * corre la versión del tag), y cuenta qué pasó. Con `--verificar`, además
 * instala y corre `typecheck`, `lint` y los unitarios de cada tienda ya
 * sincronizada: es la mejor aproximación local a lo que va a decir el CI de
 * cada tienda cuando llegue el PR.
 *
 *   pnpm template:ensayar-distribucion                    # todas las de tiendas.json
 *   pnpm template:ensayar-distribucion --verificar        # + typecheck/lint/unitarios
 *   pnpm template:ensayar-distribucion --repo dueño/tienda  # una sola (repetible)
 *   pnpm template:ensayar-distribucion --conservar        # no borra los clones
 *
 * Sólo mira lo commiteado en la rama actual: commiteá antes de correrlo.
 * Las tiendas privadas se clonan con tus credenciales de git.
 */

export type Tienda = { repo: string; dominio?: string; notas?: string };

const CAMPOS = new Set(['repo', 'dominio', 'notas']);

// Lo que no puede aparecer en un archivo público: URLs con credenciales,
// nombres de base/usuario de Hostinger (u123456_algo), tokens de GitHub.
const PARECE_SECRETO = [/:\/\/[^\s/]*:[^\s/]*@/, /\bu\d{5,}_\w+/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bgithub_pat_/];

/** `tiendas.json` validado: tira con un mensaje claro si algo no va. */
export function leerTiendas(contenido: string): Tienda[] {
  let datos: unknown;
  try {
    datos = JSON.parse(contenido);
  } catch {
    throw new Error('tiendas.json no es JSON válido');
  }
  if (!Array.isArray(datos)) throw new Error('tiendas.json tiene que ser un array');

  const vistos = new Set<string>();
  return datos.map((entrada, i) => {
    if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) {
      throw new Error(`tiendas.json[${i}] tiene que ser un objeto`);
    }
    for (const [clave, valor] of Object.entries(entrada)) {
      if (!CAMPOS.has(clave)) {
        throw new Error(
          `tiendas.json[${i}].${clave}: sólo van repo, dominio y notas — este archivo es público ` +
            '(la cuenta, el slot o la base de Hostinger van a un lugar privado)',
        );
      }
      if (typeof valor !== 'string') throw new Error(`tiendas.json[${i}].${clave} tiene que ser texto`);
      if (PARECE_SECRETO.some((patron) => patron.test(valor))) {
        throw new Error(`tiendas.json[${i}].${clave} parece una credencial o un dato de la base: sacalo`);
      }
    }
    const { repo } = entrada as Tienda;
    if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      throw new Error(`tiendas.json[${i}] necesita "repo": "dueño/nombre"`);
    }
    if (vistos.has(repo.toLowerCase())) throw new Error(`tiendas.json: ${repo} está dos veces`);
    vistos.add(repo.toLowerCase());
    return entrada as Tienda;
  });
}

export type Opciones = { verificar: boolean; conservar: boolean; repos: string[] };

export function parseArgs(argv: string[]): Opciones {
  const opciones: Opciones = { verificar: false, conservar: false, repos: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--verificar') opciones.verificar = true;
    else if (flag === '--conservar') opciones.conservar = true;
    else if (flag === '--repo') {
      const valor = argv[i + 1];
      if (!valor || valor.startsWith('--')) throw new Error('--repo espera "dueño/nombre"');
      opciones.repos.push(valor);
      i += 1;
    } else throw new Error(`no conozco la opción "${flag}"`);
  }
  return opciones;
}

function correr(comando: string, args: string[], cwd: string): { ok: boolean; salida: string } {
  try {
    const salida = execFileSync(comando, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Igual que probar-tienda-nueva.ts: sin base de tests, los de
      // integración se saltan en vez de intentar conectarse.
      env: { ...process.env, TEST_DATABASE_URL: '' },
    });
    return { ok: true, salida };
  } catch (error) {
    const fallo = error as { stdout?: string; stderr?: string };
    return { ok: false, salida: `${fallo.stdout ?? ''}${fallo.stderr ?? ''}` };
  }
}

function describir(resultado: ResultadoSync): string {
  switch (resultado.estado) {
    case 'sin-cambios':
      return 'al día, no abriría PR';
    case 'precondicion':
      return `no arranca: ${resultado.mensaje.split('\n')[0]}`;
    case 'dry-run':
      return 'dry-run';
    default: {
      const r = resultado.resumen;
      const partes = [
        `${r.traidos.length} traídos`,
        `${r.fusionados.length} fusionados`,
        `${r.restaurados.length} restaurados`,
        `${r.reemplazados.length} pisados por el template`,
        `${r.conservados.length} de la tienda sin tocar`,
      ];
      if (resultado.estado === 'conflicto') {
        return `PR en DRAFT, ${r.conflictos.length} conflicto(s): ${r.conflictos.map((c) => c.ruta).join(', ')} — ${partes.join(', ')}`;
      }
      return `PR listo — ${partes.join(', ')}`;
    }
  }
}

function main(): void {
  const opciones = parseArgs(process.argv.slice(2));
  const raiz = process.cwd();

  const rama = gitEn(raiz, ['branch', '--show-current']).trim();
  if (!rama) throw new Error('Estás con el HEAD suelto: pasate a una rama (el ensayo sincroniza contra una rama del template).');

  const repos =
    opciones.repos.length > 0
      ? opciones.repos
      : leerTiendas(readFileSync(join(raiz, 'tiendas.json'), 'utf8')).map((tienda) => tienda.repo);
  if (repos.length === 0) {
    console.log('\n  tiendas.json está vacío: nada que ensayar (pasá --repo dueño/tienda para probar una).\n');
    return;
  }

  console.log(`\n  Ensayo de la distribución desde la rama "${rama}" del template (nada se empuja).\n`);
  let fallas = 0;

  for (const repo of repos) {
    const carpeta = mkdtempSync(join(tmpdir(), `ensayo-${repo.replace('/', '-')}-`));
    const tienda = join(carpeta, 'tienda');
    try {
      const clon = correr('git', ['clone', '-q', `https://github.com/${repo}.git`, tienda], carpeta);
      if (!clon.ok) {
        console.log(`  ✗ ${repo}: no pude clonarlo\n${clon.salida}`);
        fallas += 1;
        continue;
      }
      gitEn(tienda, ['config', 'user.name', 'ensayo']);
      gitEn(tienda, ['config', 'user.email', 'ensayo@example.com']);
      gitEn(tienda, ['remote', 'add', 'template', raiz]);

      const resultado = ejecutarSync(tienda, {
        remoto: 'template',
        rama,
        dryRun: false,
        hasta: null,
        sinTests: true,
        ramaDestino: 'template/sync',
        commitearConflictos: true,
      });
      const marca = resultado.estado === 'completado' || resultado.estado === 'sin-cambios' ? '✓' : '✗';
      if (marca === '✗') fallas += 1;
      console.log(`  ${marca} ${repo}: ${describir(resultado)}`);

      if (opciones.verificar && (resultado.estado === 'completado' || resultado.estado === 'conflicto')) {
        const instalar = existsSync(join(tienda, 'pnpm-lock.yaml'))
          ? correr('pnpm', ['install', '--frozen-lockfile'], tienda)
          : { ok: false, salida: 'sin pnpm-lock.yaml' };
        const pasos: Array<[string, { ok: boolean; salida: string }]> = [['install', instalar]];
        if (instalar.ok) {
          pasos.push(['typecheck', correr('pnpm', ['typecheck'], tienda)]);
          pasos.push(['lint', correr('pnpm', ['lint'], tienda)]);
          pasos.push(['test', correr('pnpm', ['test'], tienda)]);
        }
        for (const [nombre, paso] of pasos) {
          console.log(`      ${paso.ok ? '✓' : '✗'} ${nombre}`);
          if (!paso.ok) {
            fallas += 1;
            const cola = paso.salida.trim().split('\n').slice(-15);
            for (const linea of cola) console.log(`          ${linea}`);
          }
        }
      }
    } finally {
      if (opciones.conservar) console.log(`      (clon en ${tienda})`);
      else rmSync(carpeta, { recursive: true, force: true });
    }
  }

  console.log('');
  if (fallas > 0) process.exitCode = 1;
}

if (process.argv[1] && /ensayar-distribucion\.ts$/.test(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
