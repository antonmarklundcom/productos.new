import "../src/lib/load-env";
import { eq } from "drizzle-orm";
import { closePool, getDb, getPool } from "@/db";
import {
  BACKUP_TABLES,
  bankDetails,
  categories,
  products,
  variants,
} from "@/db/schema";
import { createUser } from "@/lib/auth";
import { seedCatalog } from "./seed";

const target = process.env.TEST_DATABASE_URL;
if (
  !target ||
  !/test/i.test(new URL(target).pathname) ||
  process.env.DATABASE_URL !== target
) {
  throw new Error(
    "Browser fixtures require DATABASE_URL = an explicitly configured disposable TEST_DATABASE_URL."
  );
}
async function main(): Promise<void> {
  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;
  if (!ownerEmail || !ownerPassword)
    throw new Error("Browser fixture owner credentials missing");
  try {
    const connection = await getPool().getConnection();
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      for (const table of BACKUP_TABLES)
        await connection.query(`DELETE FROM \`${table}\``);
      await connection.query(
        "INSERT INTO counters (name, value) VALUES ('order_number', 0)"
      );
    } finally {
      try {
        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      } catch (error) {
        connection.destroy();
        throw error;
      } finally {
        connection.release();
      }
    }
    await seedCatalog(true);
    const db = getDb();
    await createUser({
      email: ownerEmail,
      password: ownerPassword,
      role: "owner",
    });
    await db
      .insert(bankDetails)
      .values({
        id: 1,
        banco: "Banco de prueba",
        titular: "Comercio de prueba",
        ruc: "80000000-0",
        cuenta: "12345",
        tipoCuenta: "corriente",
      });
    const [category] = await db
      .insert(categories)
      .values({
        slug: "browser-fixtures",
        name: "Browser fixtures",
        position: 999,
      });
    for (const saleMode of ["enquiry", "showcase", "stock"] as const) {
      const slug = `browser-${saleMode}`;
      const [product] = await db
        .insert(products)
        .values({
          slug,
          name: `Browser ${saleMode}`,
          categoryId: Number(category.insertId),
          saleMode,
          showPrice: saleMode === "stock",
          publishedAt: new Date(),
        });
      for (const [index, label] of ["Small", "Large"].entries()) {
        await db
          .insert(variants)
          .values({
            productId: Number(product.insertId),
            sku: `${slug}-${label}`,
            label,
            pricePyg: 123456,
            onHand: saleMode === "stock" ? 50 : 0,
            position: index,
          });
      }
      // Assert the fixture is actually published before the build reads it.
      const [row] = await db
        .select()
        .from(products)
        .where(eq(products.id, Number(product.insertId)));
      if (!row?.publishedAt)
        throw new Error("Browser fixture publication failed");
    }
    console.log("Disposable browser fixtures ready");
  } finally {
    await closePool();
  }
}
main().catch(async () => {
  console.error("Browser fixture preparation failed");
  await closePool();
  process.exitCode = 1;
});
