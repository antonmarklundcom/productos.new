import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import * as schema from "../src/db/schema";
import { withRequestDatabase } from "../src/db/request-context";

export type HyperdriveBinding = {
  host: string; port: number; user: string; password: string; database: string;
};
export type PreviewEnv = { HYPERDRIVE?: HyperdriveBinding };
export type PreviewContext = { waitUntil(promise: Promise<unknown>): void };
type ConnectionFactory = (options: mysql.ConnectionOptions) => Promise<mysql.Connection>;

/** No SQL text, origin credentials or driver messages in public diagnostics. */
export class PreviewDatabaseError extends Error {
  constructor(readonly code: "PREVIEW_DB_MISSING" | "PREVIEW_DB_UNAVAILABLE" | "PREVIEW_DB_UTC_REQUIRED" | "PREVIEW_DB_QUERY_BLOCKED" | "PREVIEW_DB_CLOSED") {
    super(code);
  }
}

export function hyperdriveOptions(binding: HyperdriveBinding): mysql.ConnectionOptions {
  return {
    host: binding.host, port: binding.port, user: binding.user,
    password: binding.password, database: binding.database,
    disableEval: true, timezone: "Z", charset: "utf8mb4_general_ci",
    supportBigNumbers: true, bigNumberStrings: false, multipleStatements: false,
    connectTimeout: 3000,
  };
}

export const UTC_CHECK_SQL = "SELECT @@global.time_zone AS global_zone, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offset_seconds";

/**
 * No session SET: Hyperdrive may assign a different origin connection per query.
 * This public-only pilot requires an explicitly UTC origin default and rejects
 * non-UTC/SYSTEM configurations. It never changes that default on production.
 */
export function requireUtcOrigin(rows: RowDataPacket[]): void {
  const row = rows[0];
  if (!row || !["+00:00", "UTC"].includes(String(row.global_zone)) || Number(row.offset_seconds) !== 0)
    throw new PreviewDatabaseError("PREVIEW_DB_UTC_REQUIRED");
}

function readOnlySql(query: string | mysql.QueryOptions): void {
  const text = typeof query === "string" ? query : query.sql;
  if (!/^\s*select\b/i.test(text) || /\binto\s+(?:outfile|dumpfile)\b|\bfor\s+(?:update|share)\b|\block\s+in\s+share\s+mode\b/i.test(text))
    throw new PreviewDatabaseError("PREVIEW_DB_QUERY_BLOCKED");
}

/** One physical client per request; never put it in module/global state. */
export async function openPreviewDatabase(env: PreviewEnv, createConnection: ConnectionFactory = mysql.createConnection) {
  if (!env.HYPERDRIVE) throw new PreviewDatabaseError("PREVIEW_DB_MISSING");
  let connection: mysql.Connection;
  try { connection = await createConnection(hyperdriveOptions(env.HYPERDRIVE)); }
  catch { throw new PreviewDatabaseError("PREVIEW_DB_UNAVAILABLE"); }
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const close = () => closePromise ??= (async () => {
    closed = true;
    try { await connection.end(); }
    catch { connection.destroy(); }
  })();
  try {
    const [rows] = await connection.query<RowDataPacket[]>(UTC_CHECK_SQL);
    requireUtcOrigin(rows);
  } catch (error) {
    await close();
    throw error instanceof PreviewDatabaseError ? error : new PreviewDatabaseError("PREVIEW_DB_UNAVAILABLE");
  }
  // A deliberately narrow facade prevents Drizzle .all()/raw driver .execute()
  // from silently invoking COM_STMT_PREPARE. Public reads use client.query().
  const client = {
    query(query: string | mysql.QueryOptions, values?: mysql.QueryOptions["values"]) {
      if (closed) throw new PreviewDatabaseError("PREVIEW_DB_CLOSED");
      readOnlySql(query);
      return typeof query === "string" ? connection.query(query, values) : connection.query(query, values);
    },
    execute() { throw new PreviewDatabaseError("PREVIEW_DB_QUERY_BLOCKED"); },
  };
  const database = drizzle(client as unknown as mysql.Connection, { schema, mode: "default" });
  return { database, close };
}

/** Keep the scope and client alive until streaming ends, fails or is cancelled. */
export async function withPreviewDatabase(
  request: Request, env: PreviewEnv, ctx: PreviewContext,
  next: () => Promise<Response>, createConnection?: ConnectionFactory,
): Promise<Response> {
  const session = await openPreviewDatabase(env, createConnection);
  let releaseDone!: () => void;
  const done = new Promise<void>((resolve) => { releaseDone = resolve; });
  ctx.waitUntil(done);
  let finished = false;
  const cleanup = async () => {
    if (finished) return;
    finished = true;
    request.signal.removeEventListener("abort", abort);
    try { await session.close(); } finally { releaseDone(); }
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const abort = () => {
    void reader?.cancel().catch(() => undefined);
    void cleanup();
  };
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    if (request.signal.aborted) throw new PreviewDatabaseError("PREVIEW_DB_CLOSED");
    const response = await withRequestDatabase(session.database, next);
    if (request.method === "HEAD" || !response.body) {
      await response.body?.cancel();
      await cleanup();
      return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await withRequestDatabase(session.database, () => reader!.read());
          if (chunk.done) { await cleanup(); controller.close(); }
          else controller.enqueue(chunk.value);
        } catch (error) { await cleanup(); controller.error(error); }
      },
      async cancel(reason) {
        try { await reader!.cancel(reason); } finally { await cleanup(); }
      },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) { await cleanup(); throw error; }
}
