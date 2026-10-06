import "../../src/lib/load-env";

import { closePool, getDb, getPool } from "../../src/db";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** `describe.skipIf(!hasTestDb)` — sin base, sólo corren los tests unitarios. */
export const hasTestDb = Boolean(TEST_DATABASE_URL);

// El código de dominio abre sus transacciones contra el pool de `src/db`, que
// es justamente el camino que queremos ejercitar (transacciones y FOR UPDATE
// reales, no un executor inyectado que se saltaría la transacción). El pool se
// construye recién en el primer getDb(), así que alcanza con apuntarlo acá.
if (TEST_DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

export function getTestDb() {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL no definida");
  return getDb();
}

export async function closeTestDb(): Promise<void> {
  await closePool();
}

const TABLES = [
  "notification_outbox",
  "operation_keys",
  // O5: las cinco tablas nuevas de plan-operacion §2. Van primero las que
  // cuelgan de algo (FK cascade) para no depender del orden de borrado, igual
  // que el resto de la lista.
  "order_notes",
  // Reseñas: cuelgan de `orders` y `products`.
  "product_reviews",
  // Devoluciones: primero las líneas, después la cabecera.
  "order_return_items",
  "order_returns",
  "refunds",
  "price_adjustments",
  "stock_alerts",
  "job_runs",
  "order_events",
  "stock_reservations",
  "receipts",
  "payment_events",
  "payments",
  "order_items",
  "orders",
  "stock_adjustments",
  "variants",
  "product_images",
  "products",
  "categories",
  "shipping_zones",
  // Después de `orders`, que la referencia con FK (shipping_method_id).
  "shipping_methods",
  // Antes que `users`, que la referencia con FK (updated_by).
  "bank_details",
  "store_settings",
  "integration_settings",
  "users",
  // Antes que `customers`, que la referencia con FK.
  "login_tokens",
  "customers",
  // Después de `orders`, que la referencia con FK.
  "coupons",
  "counters",
  // La marca de `POST /api/setup/init`: sin vaciarla, el segundo test de esa
  // ruta arranca creyendo que la tienda ya se inicializó.
  "setup_state",
];

/**
 * Vacía todo entre tests y deja el contador de pedidos en cero.
 *
 * `DELETE` y no `TRUNCATE`: TRUNCATE es DDL y necesita un metadata lock
 * exclusivo, así que en MySQL 8 se queda esperando —con `lock_wait_timeout`
 * por defecto, un año— si alguna conexión del pool dejó una transacción
 * abierta. `DELETE` toma locks de fila normales y las tablas de test son
 * chicas. (MariaDB, que es lo que corre en local, no se cuelga igual: esto
 * apareció recién en CI.)
 */
export async function resetTables(): Promise<void> {
  getTestDb();
  const connection = await getPool().getConnection();
  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) {
      // Nada de `ALTER TABLE ... AUTO_INCREMENT = 1` acá: también es DDL y
      // vuelve a meter el mismo metadata lock. Ningún test depende de que los
      // ids arranquen en 1 — las factories devuelven el id que crearon.
      await connection.query(`DELETE FROM \`${table}\``);
    }
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
}

/** Real checkout fixtures must configure actual usable payment methods. */
export async function seedPaymentReadiness(): Promise<void> {
  const { vi } = await import("vitest");
  vi.stubEnv("PAGOPAR_MODE", "mock");
  const { bankDetails } = await import("@/db/schema");
  await getTestDb()
    .insert(bankDetails)
    .values({
      id: 1,
      banco: "Disposable Test Bank",
      titular: "Test Store",
      ruc: "80000000-0",
      cuenta: "12345",
      tipoCuenta: "corriente",
    });
}
