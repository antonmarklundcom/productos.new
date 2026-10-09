import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type AnyD1Database } from "drizzle-orm/d1";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import * as schema from "./schema";

export type D1Binding = AnyD1Database;
const createDatabase = (binding: D1Binding) => drizzle(binding, { schema });
export type NativeDatabase = ReturnType<typeof createDatabase>;
const scope = new AsyncLocalStorage<NativeDatabase>();
const secretScope = new AsyncLocalStorage<string | undefined>();
export function getD1SessionSecret(): string | undefined { return secretScope.getStore(); }
export function getNativeDb(): NativeDatabase {
  const database = scope.getStore();
  if (!database) throw new Error("D1_STAGING_DATABASE_SCOPE_MISSING");
  return database;
}

// Preserve the legacy SELECT result tuple only at the raw-read boundary.
// Transactions are deliberately unavailable: no callback is run outside a
// transaction. Ported mutations use native atomic D1 batch operations instead.
export function getDb() {
  const database = getNativeDb();
  return new Proxy(database, {
    get(target, property) {
      if (property === "transaction") return () => { throw new Error("D1_STAGING_OPERATION_NOT_PORTED"); };
      if (property === "execute") return async (query: SQL) => {
        const text = new SQLiteAsyncDialect().sqlToQuery(query).sql;
        if (!/^\s*SELECT\b/i.test(text)) throw new Error("D1_STAGING_RAW_WRITE_BLOCKED");
        return [await target.all(query), []];
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
export const db = new Proxy({} as NativeDatabase, {
  get(_target, property) { return Reflect.get(getDb(), property); },
});
export function getPool(): never { throw new Error("D1_STAGING_NO_MYSQL_POOL"); }
export async function closePool(): Promise<void> { /* D1 has no connection pool. */ }

/** Keep context across streamed RSC/HTML responses and cancellation. */
export async function withD1Database(
  binding: D1Binding, operation: () => Promise<Response>, sessionSecret?: string,
): Promise<Response> {
  const database = createDatabase(binding);
  const response = await secretScope.run(sessionSecret, () => scope.run(database, operation));
  if (!response.body) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const part = await secretScope.run(sessionSecret, () => scope.run(database, () => reader.read()));
        if (part.done) controller.close(); else controller.enqueue(part.value);
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) { await secretScope.run(sessionSecret, () => scope.run(database, () => reader.cancel(reason))); },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
