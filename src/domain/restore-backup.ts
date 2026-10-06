import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import { pipeline } from "node:stream/promises";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getPool } from "@/db";
import { BACKUP_TABLES } from "@/db/schema";
import { applySchemaExtras } from "@/db/extras";
import { descifrarSecreto } from "@/lib/secret-box";
import { reconcile } from "./reconciliation";
import * as schema from "@/db/schema";
import {
  backupKeyCheck,
  migrationVersions,
  tablesForMigration,
  rowDigest,
  type BackupManifest,
  type BackupEnd,
} from "./backup-format";

type Row = { table: string; row: Record<string, unknown> };
type RecordLine = Row | BackupManifest | BackupEnd;
export type RestoreOptions = {
  archivo: string;
  vaciar?: boolean;
  legacy?: boolean;
};

/** Stream errors reject the iterator; nothing touches the database in this pass. */
async function* records(file: string): AsyncGenerator<RecordLine> {
  const input = createReadStream(file);
  const unzip = createGunzip();
  const done = pipeline(input, unzip);
  done.catch(() => {});
  let pending = "";
  const decoder = new StringDecoder("utf8");
  try {
    for await (const chunk of unzip) {
      pending += decoder.write(Buffer.from(chunk));
      if (Buffer.byteLength(pending) > 16 * 1024 * 1024)
        throw new Error("Línea de backup demasiado grande");
      let index: number;
      while ((index = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, index).trim();
        pending = pending.slice(index + 1);
        if (line) yield parseRecord(line);
      }
    }
    pending += decoder.end();
    if (pending.trim()) yield parseRecord(pending.trim());
    await done;
  } finally {
    input.destroy();
    unzip.destroy();
  }
}
function parseRecord(line: string): RecordLine {
  const record = JSON.parse(line);
  if (!record || typeof record !== "object" || Array.isArray(record))
    throw new Error("Registro de backup inválido");
  if (record.type === "manifest" || record.type === "end") return record;
  if (
    !(BACKUP_TABLES as readonly string[]).includes(record.table) ||
    !record.row ||
    typeof record.row !== "object" ||
    Array.isArray(record.row)
  )
    throw new Error("Tabla o fila de backup desconocida");
  return record;
}
export async function* leerBackup(file: string): AsyncGenerator<Row> {
  for await (const record of records(file)) if ("table" in record) yield record;
}
export async function inspectBackup(file: string, allowLegacy = false) {
  let manifest: BackupManifest | null = null;
  let end: BackupEnd | null = null;
  const counts: Record<string, number> = {};
  const digest = rowDigest();
  let rows = 0,
    lines = 0;
  for await (const record of records(file)) {
    if (end) throw new Error("Datos después del cierre del backup");
    if ("table" in record) {
      if (!manifest && !allowLegacy)
        throw new Error(
          "Backup sin manifiesto; para formato antiguo usar --legacy"
        );
      counts[record.table] = (counts[record.table] ?? 0) + 1;
      rows++;
      digest.update(`${JSON.stringify(record)}\n`);
    } else if (record.type === "manifest") {
      if (
        lines !== 0 ||
        record.format !== 2 ||
        !Array.isArray(record.tables) ||
        new Set(record.tables).size !== record.tables.length ||
        record.tables.some(
          (table) => !(BACKUP_TABLES as readonly string[]).includes(table)
        )
      )
        throw new Error("Manifiesto inválido");
      if (
        !migrationVersions().some(
          (v) =>
            v.tag === record.migration?.tag && v.hash === record.migration.hash
        )
      )
        throw new Error("La migración del backup no existe o su hash cambió");
      if (
        JSON.stringify([...record.tables].sort()) !==
        JSON.stringify(tablesForMigration(record.migration.tag))
      )
        throw new Error("El manifiesto omite tablas del esquema");
      manifest = record;
    } else end = record;
    lines++;
  }
  const sha256 = digest.digest("hex");
  if (manifest) {
    if (
      !end ||
      end.rows !== rows ||
      end.sha256 !== sha256 ||
      typeof end.counts !== "object"
    )
      throw new Error("Backup incompleto o checksum inválido");
    const tables = new Set(manifest.tables);
    if (
      Object.keys(counts).some((t) => !tables.has(t)) ||
      Object.keys(end.counts).some((t) => !tables.has(t)) ||
      manifest.tables.some((t) => end!.counts[t] !== (counts[t] ?? 0))
    )
      throw new Error("Los conteos del backup no coinciden");
  } else if (!allowLegacy || lines === 0)
    throw new Error("Backup vacío o sin manifiesto");
  return {
    manifest,
    end,
    rows,
    counts,
    sha256,
    keyMatches: manifest?.keyCheck
      ? manifest.keyCheck === backupKeyCheck()
      : null,
  };
}

const quote = (name: string) => "`" + name.replaceAll("`", "``") + "`";
function value(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return Number(v);
  return JSON.stringify(v);
}
async function migrationsThrough(
  connection: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  tag: string
) {
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8")
  );
  const index = journal.entries.findIndex(
    (entry: { tag: string }) => entry.tag === tag
  );
  if (index < 0) throw new Error("Migración desconocida");
  const folder = await mkdtemp(path.join(tmpdir(), "ecom-restore-migrations-"));
  try {
    await mkdir(path.join(folder, "meta"));
    await writeFile(
      path.join(folder, "meta/_journal.json"),
      JSON.stringify({
        ...journal,
        entries: journal.entries.slice(0, index + 1),
      })
    );
    for (const entry of journal.entries.slice(0, index + 1))
      await copyFile(
        path.join("drizzle", entry.tag + ".sql"),
        path.join(folder, entry.tag + ".sql")
      );
    await migrate(drizzle(connection), { migrationsFolder: folder });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Empty recovery DB only; all data writes commit together after validation. */
export async function restoreBackup(options: RestoreOptions) {
  const target = new URL(process.env.DATABASE_URL ?? "");
  if (!/restore|test/i.test(target.pathname.replace(/^\//, "")))
    throw new Error("La base destino debe contener restore o test");
  const info = await inspectBackup(options.archivo, options.legacy);
  const connection = await getPool().getConnection();
  let transaction = false;
  try {
    const [tables] = await connection.query(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'"
    );
    for (const { name } of tables as { name: string }[]) {
      if (name === "__drizzle_migrations") continue;
      const condition =
        name === "counters"
          ? " WHERE NOT (name='order_number' AND value=0)"
          : "";
      const [rows] = await connection.query(
        `SELECT COUNT(*) AS n FROM ${quote(name)}${condition}`
      );
      if (Number((rows as { n: number }[])[0]!.n))
        throw new Error(
          "La restauración exige una base vacía; no se borran datos existentes"
        );
    }
    if (
      info.manifest &&
      (tables as { name: string }[]).some(
        (table) => table.name === "__drizzle_migrations"
      )
    ) {
      const [applied] = await connection.query(
        "SELECT hash FROM __drizzle_migrations ORDER BY id DESC LIMIT 1"
      );
      const currentHash = (applied as { hash: string }[])[0]?.hash;
      const versions = migrationVersions();
      if (
        currentHash &&
        versions.findIndex((version) => version.hash === currentHash) >
          versions.findIndex(
            (version) => version.hash === info.manifest!.migration.hash
          )
      )
        throw new Error(
          "El esquema destino es más nuevo que el backup; usá una base nueva sin migraciones"
        );
      if (
        currentHash &&
        !versions.some((version) => version.hash === currentHash)
      )
        throw new Error(
          "El esquema destino no pertenece a esta versión del template"
        );
    }
    if (info.manifest)
      await migrationsThrough(connection, info.manifest.migration.tag);
    else await migrate(drizzle(connection), { migrationsFolder: "drizzle" });
    // Extras are part of the schema contract; install before FK verification.
    // Format-2 backups start at the template's current complete base schema.
    await applySchemaExtras(connection);
    const [columns] = await connection.query(
      "SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()"
    );
    const known = new Set(
      (columns as { tbl: string; col: string }[]).map(
        (r) => `${r.tbl}.${r.col}`
      )
    );
    await connection.query("SET SESSION FOREIGN_KEY_CHECKS=0");
    await connection.beginTransaction();
    transaction = true;
    // The migrator can seed this zero counter; it is the only removable row.
    await connection.query(
      "DELETE FROM counters WHERE name='order_number' AND value=0"
    );
    const digest = rowDigest();
    let rows = 0;
    let secrets = 0,
      decryptedSecrets = 0;
    for await (const record of records(options.archivo)) {
      if (!("table" in record)) {
        if (
          JSON.stringify(record) !==
          JSON.stringify(record.type === "manifest" ? info.manifest : info.end)
        )
          throw new Error("El archivo cambió durante la restauración");
        continue;
      }
      const keys = Object.keys(record.row);
      if (
        !keys.length ||
        keys.some((key) => !known.has(`${record.table}.${key}`))
      )
        throw new Error("Columna desconocida en el backup");
      await connection.execute(
        `INSERT INTO ${quote(record.table)} (${keys.map(quote).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        keys.map((key) => value(record.row[key]))
      );
      if (record.table === "integration_settings") {
        const blobs =
          typeof record.row.secrets === "string"
            ? JSON.parse(record.row.secrets)
            : record.row.secrets;
        for (const [field, blob] of Object.entries(blobs ?? {})) {
          secrets++;
          try {
            descifrarSecreto(
              String(blob),
              `integraciones/${record.row.integration}/${field}`
            );
            decryptedSecrets++;
          } catch {
            /* Report quantity only. */
          }
        }
      }
      digest.update(`${JSON.stringify(record)}\n`);
      rows++;
    }
    if (rows !== info.rows || digest.digest("hex") !== info.sha256)
      throw new Error("El archivo cambió durante la restauración");
    for (const [table, count] of Object.entries(info.counts)) {
      const [actual] = await connection.query(
        `SELECT COUNT(*) AS n FROM ${quote(table)}`
      );
      if (Number((actual as { n: number }[])[0]!.n) !== count)
        throw new Error("Conteo restaurado incorrecto");
    }
    // Re-enabling FK checks alone never validates rows loaded while disabled.
    const [fks] = await connection.query(
      "SELECT TABLE_NAME AS child, COLUMN_NAME AS childCol, REFERENCED_TABLE_NAME AS parent, REFERENCED_COLUMN_NAME AS parentCol FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL"
    );
    for (const fk of fks as {
      child: string;
      childCol: string;
      parent: string;
      parentCol: string;
    }[]) {
      const [orphans] = await connection.query(
        `SELECT COUNT(*) AS n FROM ${quote(fk.child)} c LEFT JOIN ${quote(fk.parent)} p ON c.${quote(fk.childCol)}=p.${quote(fk.parentCol)} WHERE c.${quote(fk.childCol)} IS NOT NULL AND p.${quote(fk.parentCol)} IS NULL`
      );
      if (Number((orphans as { n: number }[])[0]!.n))
        throw new Error(
          "Backup con referencias huérfanas; se revierte la carga"
        );
    }
    const [counterRows] = await connection.query(
      "SELECT (SELECT value FROM counters WHERE name='order_number') AS counter, COALESCE(MAX(CAST(SUBSTRING_INDEX(order_number, '-', -1) AS UNSIGNED)), 0) AS maximum FROM orders WHERE order_number REGEXP '^PY-[0-9]+$'"
    );
    const counter = (
      counterRows as { counter: number | null; maximum: number }[]
    )[0]!;
    if (
      counter.counter === null ||
      Number(counter.counter) < Number(counter.maximum)
    )
      throw new Error("Contador de pedidos inválido");
    await connection.commit();
    transaction = false;
    await connection.query("SET SESSION FOREIGN_KEY_CHECKS=1");
    await migrate(drizzle(connection), { migrationsFolder: "drizzle" });
    await applySchemaExtras(connection);
    const reconciliation = await reconcile(
      drizzle(connection, { schema, mode: "default" })
    );
    return {
      tablas: Object.keys(info.counts).length,
      filas: info.rows,
      keyMatches: info.keyMatches,
      legacy: !info.manifest,
      secrets,
      decryptedSecrets,
      reconciliation,
    };
  } catch (error) {
    if (transaction) await connection.rollback().catch(() => {});
    connection.destroy();
    throw error;
  } finally {
    connection.release();
  }
}
