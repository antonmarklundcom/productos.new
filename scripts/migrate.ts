import "../src/lib/load-env";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { closePool, getPool } from "@/db";
import { applySchemaExtras } from "@/db/extras";
import { safeError } from "@/lib/safe-error";

async function main(): Promise<void> {
  const connection = await getPool().getConnection();
  try {
    await migrate(drizzle(connection), { migrationsFolder: "drizzle" });
    await applySchemaExtras(connection);
    console.log("Migrations and schema extras applied");
  } finally {
    connection.release();
    await closePool();
  }
}
main().catch(async (error) => {
  console.error(safeError(error).message);
  await closePool();
  process.exitCode = 1;
});
