import "@/lib/load-env";

import { safeError } from "../src/lib/safe-error";

import { closePool, getPool } from "@/db";
import { applySchemaExtras } from "@/db/extras";

/** Corre después de `drizzle-kit push`. Idempotente. */
async function main(): Promise<void> {
  const applied = await applySchemaExtras(getPool());
  for (const item of applied) {
    console.log(`✓ ${item}`);
  }
  await closePool();
}

main().catch(async (error) => {
  console.error(safeError(error).message);
  await closePool();
  process.exit(1);
});
