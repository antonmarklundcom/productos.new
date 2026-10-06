import '@/lib/load-env';

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

/**
 * `pnpm backup` — una copia de la base, comprimida, en `backups/`.
 *
 * La tienda guarda pedidos, pagos y comprobantes de plata que entró de verdad.
 * Hasta acá nada en el repo sacaba una copia: con una tienda es un encogerse de
 * hombros, con cuatro andando es lo que termina con el negocio.
 *
 * Se corre **desde tu máquina** contra la base remota (Remote MySQL habilitado,
 * DEPLOY.md §3). En el slot de Node de Hostinger no hay `mysqldump` ni conviene
 * pelearse con los ulimits para conseguirlo.
 *
 *   pnpm backup                    # copia de DATABASE_URL en backups/
 *   pnpm backup --retener 30       # y borra las de más de 30 días
 *   pnpm backup --salida /otro/dir
 *
 * Trampa: la contraseña va por `MYSQL_PWD` y nunca como argumento. `--password`
 * en la línea de comandos lo ve cualquiera con un `ps` en la misma máquina.
 */

/** Cuántos días de copias se conservan si no se pide otra cosa. */
export const RETENCION_DIAS = 14;

export type Opciones = {
  retenerDias: number;
  salida: string;
};

/** Lee los flags. Cualquier cosa rara corta acá, antes de tocar la base. */
export function parseArgs(argv: string[]): Opciones {
  const opciones: Opciones = { retenerDias: RETENCION_DIAS, salida: 'backups' };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];

    if (flag === '--retener') {
      const valor = Number(argv[i + 1]);
      if (!Number.isInteger(valor) || valor < 1) {
        throw new Error('--retener espera un número entero de días (>= 1)');
      }
      opciones.retenerDias = valor;
      i += 1;
      continue;
    }

    if (flag === '--salida') {
      const valor = argv[i + 1];
      if (!valor || valor.startsWith('--')) throw new Error('--salida espera un directorio');
      opciones.salida = valor;
      i += 1;
      continue;
    }

    throw new Error(`no conozco la opción "${flag}"`);
  }

  return opciones;
}

export type Conexion = {
  usuario: string;
  password: string;
  base: string;
  host: string;
  puerto: number;
};

/** Mismo parseo que `pnpm db:check`: `new URL`, que es lo que usa mysql2. */
export function parseDatabaseUrl(url: string): Conexion {
  const parsed = new URL(url);
  const base = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (base === '') throw new Error('DATABASE_URL no incluye el nombre de la base');

  return {
    usuario: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    base,
    host: parsed.hostname,
    puerto: Number(parsed.port || 3306),
  };
}

/**
 * Nombre del archivo. Ordenable alfabéticamente = ordenable por fecha, que es
 * lo que hace que el borrado por antigüedad y un `ls` sean la misma cosa.
 */
export function nombreDeArchivo(base: string, fecha: Date): string {
  const sello = fecha.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `${base}-${sello}.sql.gz`;
}

/**
 * Argumentos de mysqldump. **Sin la contraseña**: ésa viaja por `MYSQL_PWD`.
 *
 *  --single-transaction  copia consistente sin lockear la tienda mientras vende
 *  --quick               fila por fila, no carga la tabla entera en memoria
 *  --routines/--events   lo que no es una tabla también es parte de la base
 *  --no-tablespaces      el usuario de Hostinger no tiene PROCESS y sin esto falla
 */
export function argumentosDeDump(conexion: Conexion): string[] {
  return [
    `--host=${conexion.host}`,
    `--port=${conexion.puerto}`,
    `--user=${conexion.usuario}`,
    '--single-transaction',
    '--quick',
    '--routines',
    '--events',
    '--no-tablespaces',
    '--default-character-set=utf8mb4',
    conexion.base,
  ];
}

/** Qué copias hay que borrar por viejas. Puro: la fecha entra, no se lee. */
export function copiasVencidas(
  archivos: Array<{ nombre: string; modificado: Date }>,
  retenerDias: number,
  ahora: Date,
): string[] {
  const limite = ahora.getTime() - retenerDias * 24 * 60 * 60 * 1000;

  return archivos
    .filter((archivo) => archivo.nombre.endsWith('.sql.gz'))
    .filter((archivo) => archivo.modificado.getTime() < limite)
    .map((archivo) => archivo.nombre);
}

/** Traduce lo que puede salir mal, igual que `pnpm db:check`. */
export function explicarFallo(codigo: number | null, stderr: string): string {
  if (/command not found|ENOENT/i.test(stderr)) {
    return (
      'no encontré `mysqldump` en el PATH. En Debian/Ubuntu viene en ' +
      '`mariadb-client` o `mysql-client`; en macOS, `brew install mysql-client`. ' +
      'Alternativa sin instalar nada: la copia que ofrece el hPanel de Hostinger'
    );
  }
  if (/Access denied/i.test(stderr)) {
    return (
      'usuario o contraseña rechazados. Corré `pnpm db:check` primero: en el hPanel ' +
      'las columnas "MySQL Database" y "MySQL User" están pegadas y es fácil transponerlas'
    );
  }
  if (/Can't connect|Unknown MySQL server host|timed out/i.test(stderr)) {
    return (
      'no llegué al servidor. Desde tu máquina hace falta habilitar tu IP en ' +
      'hPanel → Databases → Remote MySQL (DEPLOY.md §3)'
    );
  }
  if (/PROCESS privilege/i.test(stderr)) {
    return 'al usuario le falta el privilegio PROCESS; ya mandamos --no-tablespaces, revisá la versión de mysqldump';
  }

  const limpio = stderr.trim().split('\n').slice(-3).join(' ');
  return limpio === '' ? `mysqldump salió con código ${codigo}` : limpio;
}

async function main(): Promise<void> {
  const opciones = parseArgs(process.argv.slice(2));

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ DATABASE_URL no está definida.');
    process.exitCode = 1;
    return;
  }

  const conexion = parseDatabaseUrl(url);

  await mkdir(opciones.salida, { recursive: true });
  const destino = path.join(opciones.salida, nombreDeArchivo(conexion.base, new Date()));

  console.log(`\nCopia de "${conexion.base}" en ${conexion.host}:${conexion.puerto}`);
  console.log(`  destino   ${destino}\n`);

  try {
    await correrDump(conexion, destino);
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    // Un archivo a medias es peor que ninguno: parece una copia y no lo es.
    await rm(destino, { force: true });
    process.exitCode = 1;
    return;
  }

  const { size } = await stat(destino);
  console.log(`✓ copia lista — ${(size / 1024 / 1024).toFixed(2)} MB`);

  const borradas = await borrarVencidas(opciones);
  if (borradas > 0) {
    console.log(`· ${borradas} copia(s) de más de ${opciones.retenerDias} días borradas`);
  }

  console.log(
    `\nPara restaurar:\n  gunzip -c ${destino} | mysql -h HOST -u USUARIO -p BASE\n` +
      'Probalo contra una base vacía **antes** de necesitarlo: una copia que nunca se ' +
      'restauró no es una copia, es un archivo.\n',
  );
}

function correrDump(conexion: Conexion, destino: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const hijo = spawn('mysqldump', argumentosDeDump(conexion), {
      // La contraseña por entorno y no por argv: argv lo lee cualquier `ps`.
      env: { ...process.env, MYSQL_PWD: conexion.password },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    hijo.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    hijo.on('error', (error) => reject(new Error(explicarFallo(null, `${error.message} ENOENT`))));

    const salida = pipeline(hijo.stdout, createGzip(), createWriteStream(destino));

    hijo.on('close', (codigo) => {
      if (codigo !== 0) {
        reject(new Error(explicarFallo(codigo, stderr)));
        return;
      }
      salida.then(resolve, reject);
    });
  });
}

async function borrarVencidas(opciones: Opciones): Promise<number> {
  const nombres = await readdir(opciones.salida);
  const archivos = await Promise.all(
    nombres.map(async (nombre) => ({
      nombre,
      modificado: (await stat(path.join(opciones.salida, nombre))).mtime,
    })),
  );

  const vencidas = copiasVencidas(archivos, opciones.retenerDias, new Date());
  for (const nombre of vencidas) {
    await rm(path.join(opciones.salida, nombre));
  }
  return vencidas.length;
}

// Igual que `scripts/seed.ts`: los tests importan las funciones puras de acá
// arriba sin disparar un dump.
if (process.argv[1] && /backup-db\.ts$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
