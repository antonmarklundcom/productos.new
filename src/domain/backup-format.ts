import { createHash, createHmac, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { sql } from "drizzle-orm";
import journal from "../../drizzle/meta/_journal.json";
import { BACKUP_TABLES } from "@/db/schema";
import { validSessionSecret } from "@/lib/session-secret";
import type { Executor } from "./executor";

export type BackupManifest = {
  type: "manifest";
  format: 2;
  createdAt: string;
  migration: { tag: string; hash: string };
  server: string;
  app: string;
  tables: readonly string[];
  keyCheck: string | null;
};
export type BackupEnd = {
  type: "end";
  counts: Record<string, number>;
  rows: number;
  sha256: string;
};
export function backupKeyCheck(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!validSessionSecret(secret)) return null;
  const key = Buffer.from(
    hkdfSync("sha256", secret, "ecom/backup/v2", "keycheck", 32)
  );
  return createHmac("sha256", key)
    .update("keycheck")
    .digest("hex")
    .slice(0, 32);
}
export function migrationVersions() {
  const files = readMigrationFiles({ migrationsFolder: "drizzle" });
  return files.map((file, index) => ({
    tag: journal.entries[index]!.tag,
    hash: file.hash,
  }));
}
export function tablesForMigration(tag: string): string[] {
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  // Format 2 was introduced with migration 0018, after the extras contract.
  if (index < 18)
    throw new Error("La versión del backup precede al formato 2 soportado");
  const snapshot = JSON.parse(
    readFileSync(
      `drizzle/meta/${String(index).padStart(4, "0")}_snapshot.json`,
      "utf8"
    )
  );
  return Object.values(snapshot.tables as Record<string, { name: string }>)
    .map((table) => table.name)
    .sort();
}
export async function backupManifest(tx: Executor): Promise<BackupManifest> {
  const [migrationRows] = await tx.execute(
    sql`SELECT hash FROM __drizzle_migrations ORDER BY id DESC LIMIT 1`
  );
  const hash = (migrationRows as unknown as { hash: string }[])[0]?.hash;
  const migration = migrationVersions().find((v) => v.hash === hash);
  if (!migration)
    throw new Error("La versión de migración no coincide con esta aplicación");
  const [versionRows] = await tx.execute(sql`SELECT VERSION() AS version`);
  return {
    type: "manifest",
    format: 2,
    createdAt: new Date().toISOString(),
    migration,
    server: (versionRows as unknown as { version: string }[])[0]!.version,
    app: process.env.BUILD_SHA ?? "unknown",
    tables: BACKUP_TABLES,
    keyCheck: backupKeyCheck(),
  };
}
export const rowDigest = () => createHash("sha256");
