import path from "node:path";

import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

import "../src/lib/load-env";
import { applySchemaExtras } from "../src/db/extras";

/**
 * Prepara la base de tests: la recrea de cero y aplica las migraciones
 * versionadas de `drizzle/` + los extras (FULLTEXT, FK self-ref, contador).
 *
 * Si no hay `TEST_DATABASE_URL`, las suites de integración se saltan solas
 * (ver tests/helpers/db.ts) y sólo corren los tests unitarios.
 */
export async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    if (process.env.REQUIRE_DATABASE_TESTS === "1" || process.env.CI === "true")
      throw new Error(
        "Full validation requires TEST_DATABASE_URL; database checks may not be skipped."
      );
    console.warn(
      "⚠ TEST_DATABASE_URL no está definida: se saltan los tests de integración. " +
        "Levantá MySQL con `docker compose up -d` y definila en .env.local."
    );
    return;
  }

  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, "");
  if (!database)
    throw new Error("TEST_DATABASE_URL tiene que incluir el nombre de la base");
  // Cinturón y tirantes: nunca apuntar el runner de tests a la base real.
  if (!/test/i.test(database)) {
    throw new Error(
      `Me niego a resetear "${database}": el nombre de la base de tests debe contener "test"`
    );
  }

  const admin = await mysql.createConnection({
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    multipleStatements: true,
    connectTimeout: 15_000,
  });

  // MariaDB no reproduce el error de resta UNSIGNED de MySQL 8: devuelve
  // basura en silencio donde MySQL 8 (y CI) tira. Sólo un aviso, nunca falla.
  try {
    const [filas] = await admin.query("SELECT VERSION() AS version");
    const version = String(
      (filas as Array<{ version?: unknown }>)[0]?.version ?? ""
    );
    if (/mariadb/i.test(version)) {
      console.warn(
        "⚠ La suite corre contra MariaDB: una resta entre columnas UNSIGNED no va a fallar acá " +
          "aunque falle en MySQL 8 y en CI. Ver KNOWN-ISSUES.md (resta sin signo)."
      );
    }
  } catch {
    // sin versión no hay aviso; la suite sigue igual
  }

  // Sin esto, cualquier lock trabado deja la suite colgada: el default de
  // lock_wait_timeout en MySQL es de un año. Que falle en un minuto y con un
  // mensaje claro. Requiere SUPER — si no lo tenemos, seguimos igual.
  for (const statement of [
    "SET GLOBAL lock_wait_timeout = 60",
    "SET GLOBAL innodb_lock_wait_timeout = 30",
  ]) {
    try {
      await admin.query(statement);
    } catch {
      // usuario sin privilegios: no es fatal
    }
  }
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`
  );
  await admin.end();

  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 4,
    timezone: "Z",
    multipleStatements: false,
  });

  // El migrador de drizzle y no un aplicador de .sql hecho a mano: es
  // literalmente lo que corre `POST /api/setup/init` en el servidor, y además
  // deja escrita la tabla `__drizzle_migrations`. Sin eso, el `migrate()` de la
  // ruta creería que la base está vacía y trataría de crear todo de nuevo.
  await migrate(drizzle(pool), {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });

  await applySchemaExtras(pool);
  await pool.end();
}
