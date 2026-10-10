/** Disposable, local D1 only. Never uses the live remote database. */
import assert from "node:assert/strict";
import { getPlatformProxy } from "wrangler";
import { drizzle, type AnyD1Database } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import { writeD1SettingsSection } from "../workers/d1/store-settings-write";
import {
  DEFAULT_STORE_SETTINGS,
  parseStoreSettings,
} from "../src/domain/store-settings-schema";
import * as schema from "../workers/d1/schema";
const platform = await getPlatformProxy<{ DB: AnyD1Database }>({
  configPath: "workers/d1/local-settings-test.wrangler.jsonc",
  persist: false,
});
try {
  const db = drizzle(platform.env.DB, { schema });
  await db.run(sql`CREATE TABLE store_settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by_user_id INTEGER)`);
  const actor = { userId: 17 };
  const read = async () => {
    const row = await db.get<{
      data: string;
      updated_by_user_id: number;
      updated_at: string;
    }>(sql`SELECT * FROM store_settings WHERE id = 1`);
    assert.ok(row);
    return { ...row, settings: parseStoreSettings(row.data) };
  };
  const save = (
    section: Parameters<typeof writeD1SettingsSection>[1],
    values: unknown
  ) => writeD1SettingsSection(db, section, values, actor);
  await save("contacto", {
    whatsapp: "+595995628862",
    email: "owner@example.invalid",
  });
  assert.equal((await read()).settings.contacto.whatsapp, "+595995628862");
  assert.equal((await read()).updated_by_user_id, 17);
  assert.match((await read()).updated_at, /^\d{4}-\d{2}-\d{2} /);
  // Independent tabs saving different sections must preserve each other's data.
  await Promise.all([
    save("marca", { seoTitulo: "Catálogo de prueba" }),
    save("anuncio", { activo: true, texto: "Nuevo catálogo", href: "/buscar" }),
  ]);
  let row = await read();
  assert.equal(row.settings.contacto.email, "owner@example.invalid");
  assert.equal(row.settings.marca.seoTitulo, "Catálogo de prueba");
  assert.equal(row.settings.anuncio.texto, "Nuevo catálogo");
  await Promise.all([
    save("paginas", {
      envios: {
        activo: true,
        titulo: "Envíos",
        cuerpo: "Consultar antes de comprar",
      },
    }),
    save("paginas", {
      "preguntas-frecuentes": {
        activo: true,
        titulo: "Preguntas",
        cuerpo: "Contactanos",
      },
    }),
  ]);
  row = await read();
  assert.equal(row.settings.paginas.envios.titulo, "Envíos");
  assert.equal(
    row.settings.paginas["preguntas-frecuentes"].titulo,
    "Preguntas"
  );
  await save("contacto", { whatsapp: null, email: null });
  row = await read();
  assert.equal(row.settings.contacto.email, null);
  assert.equal(JSON.parse(row.data).contacto.email, null);
  assert.equal(row.settings.marca.seoTitulo, "Catálogo de prueba");
  const beforeInvalid = row.data;
  await assert.rejects(save("stock", { umbralStockBajo: -1 }));
  assert.equal((await read()).data, beforeInvalid);
  await assert.rejects(save("cuentas", { activas: true }));
  assert.equal((await read()).data, beforeInvalid);
  await save("anuncio", DEFAULT_STORE_SETTINGS.anuncio);
  assert.deepEqual(
    (await read()).settings.anuncio,
    DEFAULT_STORE_SETTINGS.anuncio
  );
  // Repair malformed legacy JSON without throwing a JSON SQLite error.
  await db.run(
    sql`UPDATE store_settings SET data = 'broken json' WHERE id = 1`
  );
  await save("vidriera", {
    estrellasEnTarjetas: false,
    barraCompraMovil: true,
  });
  assert.equal((await read()).settings.vidriera.estrellasEnTarjetas, false);
  await db.run(
    sql`UPDATE store_settings SET data = ${JSON.stringify({ contacto: { email: "preserved@example.invalid" }, paginas: "broken" })} WHERE id = 1`
  );
  await save("paginas", {
    privacidad: { activo: true, titulo: "Privacidad", cuerpo: null },
  });
  assert.equal(
    (await read()).settings.contacto.email,
    "preserved@example.invalid"
  );
  assert.equal((await read()).settings.paginas.privacidad.titulo, "Privacidad");
  const beforeFailure = (await read()).data;
  await db.run(
    sql`CREATE TRIGGER reject_settings_update BEFORE UPDATE ON store_settings BEGIN SELECT RAISE(ABORT, 'forced local settings failure'); END`
  );
  await assert.rejects(
    save("contacto", { email: "discarded@example.invalid" }),
    (error: unknown) =>
      error instanceof Error &&
      String(error.cause).includes("forced local settings failure")
  );
  assert.equal((await read()).data, beforeFailure);
  console.log(
    "PASS: local D1 settings insert, concurrent section/page saves, explicit nulls, defaults, validation, malformed JSON recovery and atomic failure"
  );
} finally {
  await platform.dispose();
}
