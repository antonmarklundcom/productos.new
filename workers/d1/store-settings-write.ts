import { sql } from "drizzle-orm";
import { DomainError } from "../../src/domain/errors";
import {
  DEFAULT_STORE_SETTINGS,
  SECTION_INPUT,
  StoreSettingsSchema,
  parseStoreSettings,
  type StoreSettingsSection,
} from "../../src/domain/store-settings-schema";
import type { MessageKey, Params } from "../../src/i18n";
import type { NativeDatabase } from "./database";

export class StoreSettingsError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = "StoreSettingsError";
  }
}

/** One SQLite UPSERT: no read/modify/write window or emulated FOR UPDATE.
 * Replace one section, or the supplied policy pages only. JSON nulls are
 * stored as null, not interpreted as deletions by a merge-patch operator.
 */
export async function writeD1SettingsSection(
  db: NativeDatabase,
  section: StoreSettingsSection,
  values: unknown,
  actor: { userId: number | null }
) {
  const validator = SECTION_INPUT[section];
  if (!validator) throw new StoreSettingsError("adminError.ajustes.seccion");
  const parsed = validator.safeParse(values ?? {});
  if (!parsed.success)
    throw new StoreSettingsError("adminError.ajustes.invalido", {
      detalle: parsed.error.issues[0]?.message ?? "",
    });
  if (
    section === "cuentas" &&
    (parsed.data as { activas?: boolean }).activas === true
  )
    throw new StoreSettingsError("adminError.ajustes.invalido", {
      detalle: "Las cuentas de cliente todavía no están habilitadas en D1.",
    });
  const defaults = JSON.stringify(DEFAULT_STORE_SETTINGS);
  const initial = StoreSettingsSchema.parse({ [section]: parsed.data });
  const base = sql`CASE WHEN json_valid(store_settings.data) THEN
    CASE WHEN json_type(store_settings.data) = 'object' THEN store_settings.data
    ELSE ${defaults} END ELSE ${defaults} END`;
  let replacement;
  if (section === "paginas") {
    // Recover a malformed pages section without discarding other settings.
    const pagesBase = sql`json_set(${base}, '$.paginas', json(CASE
      WHEN json_type(${base}, '$.paginas') = 'object' THEN json_extract(${base}, '$.paginas')
      ELSE ${JSON.stringify(DEFAULT_STORE_SETTINGS.paginas)} END))`;
    const pairs = Object.entries(parsed.data)
      .filter(([, value]) => value !== undefined)
      .flatMap(([slug, value]) => [
        sql`${`$.paginas."${slug}"`}`,
        sql`json(${JSON.stringify(value)})`,
      ]);
    replacement = pairs.length
      ? sql`json_set(${pagesBase}, ${sql.join(pairs, sql`, `)})`
      : pagesBase;
  } else {
    replacement = sql`json_set(${base}, ${`$."${section}"`}, json(${JSON.stringify(parsed.data)}))`;
  }
  const row = await db.get<{ data: string }>(sql`
    INSERT INTO store_settings (id, data, updated_at, updated_by_user_id)
    VALUES (1, ${JSON.stringify(initial)}, CURRENT_TIMESTAMP, ${actor.userId})
    ON CONFLICT(id) DO UPDATE SET data = ${replacement},
      updated_at = CURRENT_TIMESTAMP, updated_by_user_id = excluded.updated_by_user_id
    RETURNING data`);
  if (!row) throw new Error("D1_SETTINGS_SAVE_MISSING_RESULT");
  return parseStoreSettings(row.data);
}
