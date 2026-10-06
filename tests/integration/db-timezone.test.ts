import { afterAll, describe, expect, it } from "vitest";

import { getPool } from "@/db";

import { closeTestDb, getTestDb, hasTestDb } from "../helpers/db";

/**
 * Cada conexión del pool habla en UTC (`src/db/index.ts`). Sin esto, en un
 * MySQL con la hora del servidor (Hostinger: `time_zone = SYSTEM`) `NOW()` y
 * `expires_at` quedaban en zonas distintas y las reservas de stock vencían
 * antes de nacer o duraban horas de más. CI corre MySQL con otra hora a
 * propósito para que esto se vea.
 */
describe.skipIf(!hasTestDb)("zona horaria de la sesión", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("toda conexión del pool está en UTC, aunque el servidor no lo esté", async () => {
    // `getTestDb()` apunta el pool de la app a la base de tests; el que se
    // mira es ese pool, que es donde vive el `SET time_zone`.
    getTestDb();
    const pool = getPool();
    // Varias a la vez: fuerza conexiones nuevas, no sólo la primera.
    const filas = await Promise.all(
      Array.from({ length: 4 }, () =>
        pool.query("SELECT @@session.time_zone AS tz, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS desfase")
      )
    );
    for (const [rows] of filas) {
      const [fila] = rows as Array<{ tz: string; desfase: number }>;
      expect(fila?.tz).toBe("+00:00");
      expect(Number(fila?.desfase)).toBe(0);
    }
  });
});
