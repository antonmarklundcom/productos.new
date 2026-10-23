import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { literalContains } from "../../src/lib/sql-like";

describe("portable literal substring predicates", () => {
  it.each(["A_B", "100%", "USB_C_100%", String.raw`folder\name`, "!bang", "' OR 1=1 --"])("matches %s literally using both rendered dialects", (term) => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("CREATE TABLE entries (name TEXT NOT NULL)");
      const insert = database.prepare("INSERT INTO entries VALUES (?)");
      insert.run("prefix " + term + " suffix");
      insert.run("unrelated wildcard lookalike A-B USBXCX100 other");
      for (const dialect of [new SQLiteSyncDialect(), new MySqlDialect()]) {
        const query = dialect.sqlToQuery(sql`SELECT name FROM entries WHERE ${literalContains(sql`name`, term)}`);
        const bindings = query.params.map((value) => {
          if (typeof value !== 'string') throw new Error('Expected bound search text');
          return value;
        });
        const rows = database.prepare(query.sql).all(...bindings);
        expect(rows).toEqual([{ name: "prefix " + term + " suffix" }]);
        expect(query.sql).not.toContain(term);
      }
    } finally { database.close(); }
  });
});
