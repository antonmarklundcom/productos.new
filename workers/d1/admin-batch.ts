import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import type { NativeDatabase } from "./database";
/** D1's Drizzle raw-query batch adapter lacks bound stmt support. Compile
 * reviewed query builders and raw SQL to native statements before batching. */
export async function executeAdminBatch(
  db: NativeDatabase,
  queries: readonly { getSQL(): SQL }[]
) {
  const dialect = new SQLiteAsyncDialect();
  return db.$client.batch(
    queries.map((query) => {
      const built = dialect.sqlToQuery(query.getSQL());
      return db.$client.prepare(built.sql).bind(...built.params);
    })
  );
}
