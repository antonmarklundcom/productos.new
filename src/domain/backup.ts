import { safeError } from "@/lib/safe-error";
import { createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { drizzle } from "drizzle-orm/mysql2";

import { sql } from "drizzle-orm";

import { getPool } from "@/db";
import * as schema from "@/db/schema";
import { backupManifest, rowDigest } from "./backup-format";
import { BACKUP_TABLES, type BackupTable } from "@/db/schema";
import {
  carpetaBackups,
  cloudinary,
  cloudinaryConfigured,
} from "@/lib/cloudinary";
import { log } from "@/lib/log";
import { PY_TIMEZONE } from "@/lib/py";

import type { Executor } from "./executor";

/**
 * Copias de seguridad de la base, desde adentro de la app (plan-operacion §5.4 A).
 *
 * `pnpm backup` ya existía y sigue existiendo: es el camino "grande",
 * `mysqldump` corrido **desde la máquina de Anton** contra la base remota. Su
 * problema es que depende de que alguien se acuerde. Esto es el otro camino:
 * un cron que corre solo, todos los días, sin que nadie haga nada.
 *
 * ### Las cuatro decisiones que da el entorno
 *
 * 1. **No hay `mysqldump` en el slot de Hostinger**, ni conviene pelearse con
 *    los ulimits para conseguirlo. Así que el dump es JavaScript: `SELECT *`
 *    paginado y JSON Lines.
 * 2. **Hay poca RAM.** Nunca se arma la base entera en memoria: se pagina de a
 *    1.000 filas y se escribe a un stream comprimido. Una tienda con 50.000
 *    pedidos tiene que poder sacar su copia en un slot compartido.
 * 3. **La lista de tablas es explícita** (`BACKUP_TABLES` en `schema.ts`), no
 *    `SHOW TABLES`. Una tabla nueva que nadie decidió incluir hace fallar un
 *    test en vez de entrar sola —o, peor, quedar afuera en silencio.
 * 4. **`raw_payload` de `payments` va entero.** Es el aviso crudo de Pagopar y
 *    es parte del rastro de la plata: un backup que lo trunca no sirve para
 *    reconstruir un incidente, que es justo cuando se usa un backup.
 *
 * ### El formato
 *
 * JSON Lines comprimido: una línea por fila, `{"table":"orders","row":{…}}`.
 * El formato 2 agrega manifiesto de versión y un cierre con conteos y checksum.
 * Un archivo incompleto se rechaza antes de restaurar. La lectura usa una sola
 * conexión con snapshot consistente; la carga sólo acepta una base de recuperación vacía.
 */

/** Cuántas filas por consulta. Ver la decisión 2. */
export const PAGE_SIZE = 1_000;

/** Cuántos días se conservan las copias en Cloudinary. */
export const RETAIN_DAYS = 14;

export type DumpStats = { tables: number; rows: number };

/**
 * Vuelca la base a un stream de JSON Lines (sin comprimir).
 *
 * La paginación va por **clave primaria** y no por `OFFSET`: con `OFFSET`, una
 * fila insertada a mitad del dump corre el resto y una fila se salta o se
 * duplica. Todas las tablas de `BACKUP_TABLES` tienen `id` autoincremental
 * salvo `counters` (PK `name`), `setup_state`, `bank_details`, `store_settings` y `job_runs`,
 * que son de una o dos filas y se traen enteras.
 */
export async function* dumpRows(
  executor?: Executor
): AsyncGenerator<{ table: BackupTable; row: Record<string, unknown> }> {
  if (!executor) {
    const connection = await getPool().getConnection();
    let completed = false;
    try {
      await connection.query(
        "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ"
      );
      await connection.query(
        "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"
      );
      yield* dumpRows(drizzle(connection, { schema, mode: "default" }));
      await connection.commit();
      completed = true;
    } catch (error) {
      connection.destroy();
      throw error;
    } finally {
      if (!completed) connection.destroy();
      connection.release();
    }
    return;
  }
  const tx = executor;

  for (const table of BACKUP_TABLES) {
    const pk = PRIMARY_KEY[table];

    if (pk === null) {
      // Tablas de configuración: una puñado de filas, sin paginar.
      const result = await tx.execute(sql.raw(`SELECT * FROM \`${table}\``));
      for (const row of rowsOf(result)) yield { table, row };
      continue;
    }

    let desde: number | string | null = null;
    for (;;) {
      const where = desde === null ? "" : `WHERE \`${pk}\` > ${escapar(desde)}`;
      const result = await tx.execute(
        sql.raw(
          `SELECT * FROM \`${table}\` ${where} ORDER BY \`${pk}\` ASC LIMIT ${PAGE_SIZE}`
        )
      );
      const filas = rowsOf(result);
      if (filas.length === 0) break;

      for (const row of filas) yield { table, row };

      if (filas.length < PAGE_SIZE) break;

      // El cursor de la página siguiente. Si la columna no vino —un `pk` mal
      // escrito en `PRIMARY_KEY`— se corta con un error claro en vez de
      // quedarse en un bucle infinito volcando la misma página para siempre,
      // que es la peor forma de fallar que puede tener un backup.
      const ultima = filas[filas.length - 1]!;
      const cursor = ultima[pk];
      if (typeof cursor !== "number" && typeof cursor !== "string") {
        throw new Error(
          `La tabla ${table} no devolvió la columna "${pk}" para paginar`
        );
      }
      desde = cursor;
    }
  }
}

/**
 * El dump entero como stream **comprimido**, listo para subir.
 *
 * Devuelve también las cantidades, que se resuelven recién cuando el stream
 * termina de consumirse — por eso es una promesa y no un número.
 */
export function dumpDatabase(executor?: Executor): {
  stream: Readable;
  stats: Promise<DumpStats>;
} {
  // Los `!` son honestos: el ejecutor de una promesa corre de forma síncrona,
  // así que las dos quedan asignadas antes de la línea siguiente. TypeScript
  // no lo sabe.
  let resolver!: (stats: DumpStats) => void;
  let rechazar!: (error: unknown) => void;
  const stats = new Promise<DumpStats>((resolve, reject) => {
    resolver = resolve;
    rechazar = reject;
  });

  const lineas = Readable.from(
    (async function* () {
      const connection = executor ? null : await getPool().getConnection();
      let completed = false;
      try {
        if (connection) {
          await connection.query(
            "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ"
          );
          await connection.query(
            "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"
          );
          const [engines] = await connection.query(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND ENGINE <> 'InnoDB'"
          );
          if ((engines as unknown[]).length)
            throw new Error("El backup exige tablas InnoDB");
        }
        const tx =
          executor ?? drizzle(connection!, { schema, mode: "default" });
        const manifest = await backupManifest(tx);
        yield `${JSON.stringify(manifest)}\n`;
        const tablas = new Set<string>();
        const counts = Object.fromEntries(
          BACKUP_TABLES.map((table) => [table, 0])
        );
        const digest = rowDigest();
        let filas = 0;
        for await (const { table, row } of dumpRows(tx)) {
          tablas.add(table);
          filas += 1;
          counts[table]! += 1;
          const line = `${JSON.stringify({ table, row })}\n`;
          digest.update(line);
          yield line;
        }
        yield `${JSON.stringify({ type: "end", counts, rows: filas, sha256: digest.digest("hex") })}\n`;
        if (connection) await connection.commit();
        completed = true;
        resolver({ tables: tablas.size, rows: filas });
      } catch (error) {
        connection?.destroy();
        rechazar(error);
        throw error;
      } finally {
        if (!completed) connection?.destroy();
        connection?.release();
      }
    })()
  );

  // Sin esto, si la subida falla antes de que el dump termine, `stats` queda
  // rechazada y sin nadie escuchándola: Node lo reporta como unhandled
  // rejection y —según la versión— mata el proceso. Quien llama sigue viendo
  // el rechazo porque `runBackup` la espera.
  stats.catch(() => {});

  const stream = createGzip();
  // pipeline forwards failures both ways; attach handlers before consumption.
  void pipeline(lineas, stream, {
    signal: AbortSignal.timeout(20 * 60_000),
  }).catch((error) => {
    rechazar(error);
    stream.destroy(error);
  });
  return { stream, stats };
}

/** El nombre del archivo: la fecha y hora **de Asunción**, que es la que el dueño lee. */
export function backupPublicId(now: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("sv-SE", {
    timeZone: PY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  // `sv-SE` da `2026-08-12 03:00`; se normaliza a algo que sea un `public_id`
  // válido y que ordene alfabéticamente igual que cronológicamente.
  return `backup-${partes.replace(" ", "T").replace(":", "")}`;
}

export type UploadResult = { publicId: string; bytes: number };

/**
 * Sube el stream a Cloudinary.
 *
 * `resource_type: 'raw'` (no es una imagen) y **`type: 'authenticated'`**: un
 * backup en una carpeta pública es la base de datos del comercio servida por
 * CDN a quien adivine la URL. Con `authenticated`, sin firma no se descarga.
 */
export async function uploadBackup(
  stream: NodeJS.ReadableStream,
  publicId: string
): Promise<UploadResult> {
  let subida!: ReturnType<typeof cloudinary.uploader.upload_stream>;
  let rejectUpload!: (error: Error) => void;
  const result = new Promise<UploadResult>((resolve, reject) => {
    rejectUpload = reject;
    subida = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        type: "authenticated",
        folder: carpetaBackups(),
        public_id: publicId,
        overwrite: false,
      },
      (error, result) => {
        if (error || !result)
          return reject(error ?? new Error("Cloudinary no devolvió resultado"));
        resolve({ publicId: result.public_id, bytes: result.bytes ?? 0 });
      }
    );
  });
  const signal = AbortSignal.timeout(20 * 60_000);
  const abort = () => rejectUpload(new Error("Backup upload timeout"));
  signal.addEventListener("abort", abort, { once: true });
  try {
    const [uploaded] = await Promise.all([
      result,
      pipeline(stream, subida, { signal }),
    ]);
    return uploaded;
  } catch (error) {
    subida.destroy(error instanceof Error ? error : new Error("Upload failed"));
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/**
 * Borra las copias de más de `retainDays` días.
 *
 * Sin esto, la carpeta crece para siempre y la cuenta de Cloudinary se llena
 * — y cuando se llena, deja de aceptar **la copia de hoy**, que es la que
 * importa. La retención no es prolijidad: es lo que hace que el backup siga
 * funcionando dentro de un año.
 */
export async function pruneBackups(
  retainDays = RETAIN_DAYS,
  now: Date = new Date()
): Promise<number> {
  const limite = new Date(now.getTime() - retainDays * 24 * 3600_000);

  const listado = await cloudinary.api.resources({
    resource_type: "raw",
    type: "authenticated",
    prefix: `${carpetaBackups()}/`,
    max_results: 500,
  });

  const viejos = (listado.resources ?? [])
    .filter((recurso: { created_at?: string }) =>
      recurso.created_at ? new Date(recurso.created_at) < limite : false
    )
    .map((recurso: { public_id: string }) => recurso.public_id);

  if (viejos.length === 0) return 0;

  await cloudinary.api.delete_resources(viejos, {
    resource_type: "raw",
    type: "authenticated",
  });

  return viejos.length;
}

export type BackupResult = {
  publicId: string;
  bytes: number;
  tables: number;
  rows: number;
  pruned: number;
};

/** ¿Esta tienda puede sacar copias automáticas? Sin Cloudinary, no. */
export function backupsEnabled(): boolean {
  return cloudinaryConfigured();
}

/** El backup completo: dump → subida → retención. */
export async function runBackup(
  options: { now?: Date } = {}
): Promise<BackupResult> {
  if (!backupsEnabled()) {
    throw new Error(
      "Cloudinary no está configurado: no hay dónde guardar la copia"
    );
  }

  const publicId = backupPublicId(options.now);
  const { stream, stats } = dumpDatabase();

  const [subida, { tables, rows }] = await Promise.all([
    uploadBackup(stream, publicId),
    stats,
  ]);

  // La retención va **después** de subir la de hoy, y su fallo no invalida el
  // backup: se prefiere una carpeta con una copia de más que una corrida
  // marcada como fallida cuando la copia de hoy ya está guardada.
  let pruned = 0;
  try {
    pruned = await pruneBackups(RETAIN_DAYS, options.now);
  } catch (error) {
    log.warn("no se pudieron borrar los backups viejos", {
      error: safeError(error).message,
    });
  }

  return {
    publicId: subida.publicId,
    bytes: subida.bytes,
    tables,
    rows,
    pruned,
  };
}

/**
 * La clave por la que se pagina cada tabla. `null` = traerla entera.
 *
 * Escrita a mano y no derivada del schema a propósito: es la decisión de "esta
 * tabla es chica y se puede traer de una", y esa decisión tiene que ser
 * explícita. El test de cobertura verifica que estén **todas** las de
 * `BACKUP_TABLES`.
 */
export const PRIMARY_KEY: Record<BackupTable, string | null> = {
  notification_outbox: "id",
  operation_keys: "id",
  counters: null,
  setup_state: null,
  job_runs: null,
  bank_details: null,
  store_settings: null,
  integration_settings: null,
  users: "id",
  customers: "id",
  categories: "id",
  coupons: "id",
  shipping_zones: "id",
  shipping_methods: "id",
  payment_events: "id",
  login_tokens: "id",
  products: "id",
  product_images: "id",
  variants: "id",
  stock_alerts: "id",
  price_adjustments: "id",
  stock_adjustments: "id",
  orders: "id",
  order_items: "id",
  order_events: "id",
  order_notes: "id",
  product_reviews: "id",
  order_returns: "id",
  order_return_items: "id",
  payments: "id",
  refunds: "id",
  receipts: "id",
  stock_reservations: "id",
};

/**
 * El cursor de la paginación, escapado.
 *
 * Es lo único que se interpola en el SQL, y viene de una fila que **acaba de
 * salir de esta misma base**, no de un usuario. Aun así se escapa: un id
 * numérico se valida como número y una PK de texto va entre comillas con las
 * comillas escapadas. Una interpolación sin escapar en un archivo que arma SQL
 * a mano es exactamente el tipo de cosa que después nadie vuelve a mirar.
 */
function escapar(valor: number | string): string {
  if (typeof valor === "number") {
    if (!Number.isFinite(valor))
      throw new Error("cursor de paginación inválido");
    return String(valor);
  }
  return `'${valor.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** mysql2 devuelve `[rows, fields]`; drizzle a veces pasa las filas peladas. */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const candidate = Array.isArray(result) ? result[0] : result;
  return Array.isArray(candidate)
    ? (candidate as Array<Record<string, unknown>>)
    : [];
}
