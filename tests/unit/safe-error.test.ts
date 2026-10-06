import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { safeError } from "@/lib/safe-error";
import { databaseDate } from "@/lib/database-date";

describe("safe diagnostics", () => {
  it("removes real-shaped SQL parameters, tokenized URLs and personal information", () => {
    const secret = [
      "+595981555555",
      "private@example.test",
      "Secret Address 123",
      "private-access-token",
    ];
    const cause = Object.assign(new Error(secret.join(" ")), {
      code: "ER_DUP_ENTRY",
    });
    const error = new DrizzleQueryError(
      "INSERT INTO orders VALUES (?, ?, ?, ?)",
      secret,
      cause
    );
    error.stack +=
      "\n    at fetch (https://provider.test?token=private-access-token:1:2)";
    const output = JSON.stringify(safeError(error));
    for (const value of secret) expect(output).not.toContain(value);
    expect(output).not.toContain("INSERT");
    expect(output).toContain("ER_DUP_ENTRY");
  });
  it("reads timezone-free database aggregate strings as UTC", () => {
    expect(databaseDate("2026-06-10 12:00:00").toISOString()).toBe(
      "2026-06-10T12:00:00.000Z"
    );
  });
});
