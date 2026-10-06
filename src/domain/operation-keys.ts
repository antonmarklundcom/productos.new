import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { withLockRetry } from "@/db/retry";
import { operationKeys } from "@/db/schema";
import { DomainError } from "./errors";
import type { Executor } from "./executor";

export class OperationKeyReusedError extends DomainError {
  constructor() {
    super("error.operacion.reutilizada");
    this.name = "OperationKeyReusedError";
  }
}
class CommittedOperation extends Error {}
export function canonicalPayload(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalPayload(v)}`)
    .join(",")}}`;
}
function duplicate(error: unknown): boolean {
  for (
    let cursor: unknown = error, n = 0;
    cursor && typeof cursor === "object" && n < 5;
    n++
  ) {
    const row = cursor as { code?: string; cause?: unknown };
    if (row.code === "ER_DUP_ENTRY") return true;
    cursor = row.cause;
  }
  return false;
}
/** The key insert is the transaction's first lock; failed work leaves no key. */
export async function operationTransaction<T>(
  options: {
    scope: "checkout" | "refund" | "return";
    key?: string;
    payload: unknown;
  },
  run: (tx: Executor) => Promise<T>
): Promise<{ result: T; replay: boolean }> {
  const key = options.key;
  if (
    key !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      key
    )
  )
    throw new OperationKeyReusedError();
  const fingerprint = createHash("sha256")
    .update(canonicalPayload(options.payload))
    .digest("hex");
  try {
    const result = await withLockRetry(() =>
      getDb().transaction(async (tx) => {
        if (key) {
          try {
            await tx
              .insert(operationKeys)
              .values({ scope: options.scope, opKey: key, fingerprint });
          } catch (error) {
            if (duplicate(error)) throw new CommittedOperation();
            throw error;
          }
        }
        const result = await run(tx);
        if (key)
          await tx
            .update(operationKeys)
            .set({ result: JSON.parse(JSON.stringify(result)) })
            .where(
              and(
                eq(operationKeys.scope, options.scope),
                eq(operationKeys.opKey, key)
              )
            );
        return result;
      })
    );
    return { result, replay: false };
  } catch (error) {
    if (!(error instanceof CommittedOperation) || !key) throw error;
    // A fresh statement after rollback sees the winner's committed result.
    const [row] = await getDb()
      .select()
      .from(operationKeys)
      .where(
        and(
          eq(operationKeys.scope, options.scope),
          eq(operationKeys.opKey, key)
        )
      )
      .limit(1);
    if (!row || row.fingerprint !== fingerprint)
      throw new OperationKeyReusedError();
    if (row.result === null) throw new DomainError("error.operacion.archivada");
    return { result: row.result as T, replay: true };
  }
}
export async function purgeOperationKeys(): Promise<void> {
  // Retain the key tombstone: deleting it would permit an old retry to charge again.
  await getDb()
    .update(operationKeys)
    .set({ result: null })
    .where(
      sql`${operationKeys.createdAt} < NOW() - INTERVAL 30 DAY AND ${operationKeys.result} IS NOT NULL`
    );
}
