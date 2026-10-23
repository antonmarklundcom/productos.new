import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/** A literal substring, with one explicit escape convention for MySQL and SQLite. */
export function literalContains(column: SQLWrapper, term: string): SQL {
  const pattern = `%${term.replace(/[!%_]/g, (character) => `!${character}`)}%`;
  return sql`${column} LIKE ${pattern} ESCAPE '!'`;
}
