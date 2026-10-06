import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import type { PoolConnection } from 'mysql2';
import mysql from 'mysql2/promise';

import * as schema from './schema';

/**
 * One pool per process. Hostinger caps concurrent connections per DB user —
 * a bigger pool buys nothing and produces random ER_CON_COUNT_ERROR under load.
 */
const POOL_OPTIONS = {
  connectionLimit: 8,
  // Store and read everything in UTC; business logic converts to America/Asuncion.
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: false,
  charset: 'utf8mb4_general_ci',
} as const;

export type Database = MySql2Database<typeof schema>;

/**
 * Cada conexión nueva habla en UTC con MySQL, no sólo del lado de mysql2.
 *
 * `timezone: 'Z'` convierte los `Date` de JS, pero `NOW()`, los
 * `DEFAULT CURRENT_TIMESTAMP` y la lectura de columnas `TIMESTAMP` usan la
 * zona de la **sesión**, que en un MySQL con `time_zone = SYSTEM` (el default
 * de Hostinger) es la hora del servidor. Con el servidor fuera de UTC, una
 * reserva de stock de 45 minutos nacía vencida (o duraba horas de más) porque
 * `expires_at` (UTC) se comparaba con `NOW()` (hora local), y dos compradoras
 * podían llevarse la última unidad. `tests/integration/db-timezone.test.ts`
 * lo fija, y CI corre MySQL con otra hora a propósito.
 *
 * El `SET` sale antes que cualquier consulta: mysql2 emite `connection` antes
 * de entregar la conexión, y cada conexión ejecuta sus comandos en orden.
 */
function fijarSesionEnUtc(connection: PoolConnection): void {
  connection.query("SET time_zone = '+00:00'", (error) => {
    if (!error) return;
    // Una conexión en la hora equivocada corrompe fechas en silencio: mejor
    // tirarla y que el pool abra otra.
    console.error('No se pudo fijar time_zone en UTC; se descarta la conexión', error);
    connection.destroy();
  });
}

declare global {
  // Next.js dev reloads the module graph on every edit; without this the pool
  // count grows until MySQL refuses new connections.
  var __ecomPool: mysql.Pool | undefined;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL no está definida. Copiá .env.example a .env.local y completala. ' +
        '(tsx no carga .env solo: usá `import "dotenv/config"` al inicio de cada script.)',
    );
  }
  return url;
}

export function getPool(): mysql.Pool {
  if (!globalThis.__ecomPool) {
    const pool = mysql.createPool({ uri: connectionString(), ...POOL_OPTIONS });
    // El pool de callbacks: el evento del pool de promesas trae la misma conexión
    // cruda, pero tipada como si fuera de promesas.
    pool.pool.on('connection', fijarSesionEnUtc);
    globalThis.__ecomPool = pool;
  }
  return globalThis.__ecomPool;
}

let cachedDb: Database | undefined;

/** Lazily built so importing this module never requires DATABASE_URL. */
export function getDb(): Database {
  if (!cachedDb) {
    cachedDb = drizzle(getPool(), { schema, mode: 'default' });
  }
  return cachedDb;
}

/** Ambient handle for app code: `db.select()...`. Scripts/tests can use getDb(). */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
});

export async function closePool(): Promise<void> {
  if (globalThis.__ecomPool) {
    await globalThis.__ecomPool.end();
    globalThis.__ecomPool = undefined;
    cachedDb = undefined;
  }
}

export { schema };
