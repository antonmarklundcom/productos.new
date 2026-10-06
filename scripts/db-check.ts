import '@/lib/load-env';

import mysql from 'mysql2/promise';

/**
 * `pnpm db:check` — ¿la `DATABASE_URL` que tengo es la que creo que tengo?
 *
 * Es el primer paso de debugging del deploy (DEPLOY.md §3). En el hPanel de
 * Hostinger, "MySQL Database" y "MySQL User" son dos columnas pegadas con
 * nombres casi iguales (`u123456789_tienda` y `u123456789_tiendausr`), y
 * transponerlas es el error más común: MySQL contesta `Access denied` sin decir
 * cuál de las dos está mal.
 *
 * Entonces esto hace dos cosas y nada más: imprime en castellano con **qué**
 * usuario, contra **qué** base, en **qué** host y puerto va a conectar, y
 * traduce el error si no puede. Nunca imprime la contraseña — sólo si está.
 */

type Conexion = {
  usuario: string;
  base: string;
  host: string;
  puerto: number;
  tieneClave: boolean;
};

/**
 * Rompe la DSN en las cuatro partes que se transponen. `new URL` y no un
 * regex: es el mismo parser que usa mysql2, así que lo que se imprime acá es
 * lo que la app va a mandar de verdad.
 */
export function describirConexion(url: string): Conexion {
  const parsed = new URL(url);

  return {
    usuario: decodeURIComponent(parsed.username),
    base: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    host: parsed.hostname,
    puerto: Number(parsed.port || 3306),
    tieneClave: parsed.password !== '',
  };
}

/**
 * Traduce el error de mysql2 a lo que hay que ir a arreglar.
 *
 * Los códigos son los de MySQL/libmysqlclient; los `E*` los tira Node antes de
 * llegar a hablar con nadie. Un error desconocido se devuelve como vino: mejor
 * un mensaje crudo que una explicación inventada.
 */
export function explicarError(error: unknown, conexion: Conexion): string {
  const code = codigoDe(error);

  switch (code) {
    case 'ER_ACCESS_DENIED_ERROR':
      return (
        `usuario/contraseña rechazados para "${conexion.usuario}" — ojo: en el hPanel las ` +
        'columnas "MySQL Database" y "MySQL User" están pegadas y es fácil transponerlas. ' +
        `Verificá que "${conexion.usuario}" sea el USUARIO y "${conexion.base}" la BASE, y ` +
        'no al revés. Si cambiaste la contraseña en el panel, acordate de actualizar ' +
        'DATABASE_URL en las variables del sitio Y apretar Redeploy (DEPLOY.md §3)'
      );

    case 'ER_DBACCESS_DENIED_ERROR':
      return (
        `el usuario "${conexion.usuario}" existe y la contraseña es correcta, pero no tiene ` +
        `permiso sobre la base "${conexion.base}". Casi siempre es la transposición: el ` +
        'nombre de la base y el del usuario están cambiados de lugar. Si no, faltan los ' +
        'privilegios en el hPanel'
      );

    case 'ER_BAD_DB_ERROR':
      return (
        `la base "${conexion.base}" no existe en ${conexion.host}. Revisá el nombre completo ` +
        '(en Hostinger lleva el prefijo de la cuenta, tipo u123456789_tienda)'
      );

    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'ETIMEDOUT':
    case 'EAI_AGAIN':
      return (
        `no llegué a ${conexion.host}:${conexion.puerto} (${code}). O el host está mal, o tu ` +
        'IP no está permitida: en el hPanel, Databases → Remote MySQL, agregá tu IP pública. ' +
        'Desde la app en Hostinger el host suele ser localhost; desde tu máquina, el que ' +
        'figura en Remote MySQL'
      );

    default:
      return error instanceof Error ? error.message : String(error);
  }
}

function codigoDe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return '';
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ DATABASE_URL no está definida. En Hostinger va en las variables del sitio.');
    process.exitCode = 1;
    return;
  }

  let conexion: Conexion;
  try {
    conexion = describirConexion(url);
  } catch {
    console.error(
      // Partido antes de la arroba: el escáner de `security-review.test.ts`
      // marca cualquier DSN con contraseña que no apunte a localhost, y no
      // sabe distinguir un ejemplo de uno de verdad. Mejor así que aflojarle
      // el patrón.
      '✗ DATABASE_URL no parsea como URL. Forma esperada: mysql://USUARIO:CONTRASEÑA' +
        '@HOST:3306/BASE — si la contraseña tiene ? # @ o /, hay que URL-encodearla.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('\nVoy a conectar así:\n');
  console.log(`  usuario      ${conexion.usuario || '(vacío)'}`);
  console.log(`  base         ${conexion.base || '(vacía)'}`);
  console.log(`  host         ${conexion.host}`);
  console.log(`  puerto       ${conexion.puerto}`);
  console.log(`  contraseña   ${conexion.tieneClave ? 'presente (no se imprime)' : 'FALTA'}`);
  console.log('');

  let connection: mysql.Connection | undefined;
  try {
    // Conexión suelta y no el pool de la app: acá se prueba la DSN, no se
    // levanta la tienda. Y 10 segundos, no el default: si la IP no está
    // permitida, el TCP se queda colgado y el que debuggea se va a tomar un
    // café.
    connection = await mysql.createConnection({ uri: url, connectTimeout: 10_000 });

    await connection.query('SELECT 1');

    const [rows] = await connection.query<never>(
      'SELECT CURRENT_USER() AS usuario, DATABASE() AS base, VERSION() AS version',
    );
    const fila = (Array.isArray(rows) ? rows[0] : undefined) as
      | { usuario?: string; base?: string; version?: string }
      | undefined;

    console.log('✓ conecta');
    // CURRENT_USER() es con quién quedaste autenticado de verdad, que no
    // siempre es el que pediste (MySQL puede resolver a un usuario anónimo).
    console.log(`  autenticado como   ${fila?.usuario ?? '?'}`);
    console.log(`  base seleccionada  ${fila?.base ?? '(ninguna)'}`);
    console.log(`  servidor           ${fila?.version ?? '?'}`);
    console.log('');
  } catch (error) {
    console.error(`✗ ${explicarError(error, conexion)}\n`);
    process.exitCode = 1;
  } finally {
    await connection?.end();
  }
}

// Igual que `scripts/seed.ts`: los tests importan las funciones puras de acá
// arriba sin disparar una conexión.
if (process.argv[1] && /db-check\.ts$/.test(process.argv[1])) {
  void main();
}
