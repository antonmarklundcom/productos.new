import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cache } from "react";
import {
  DEFAULT_STORE_SETTINGS,
  parseStoreSettings,
  type StoreSettings,
  type StoreSettingsSection,
} from "../../src/domain/store-settings-schema";
import { log, mensajeDe } from "../../src/lib/log";
import { getNativeDb, type NativeDatabase } from "./database";
import { storeSettings } from "./schema";
import { writeD1SettingsSection } from "./store-settings-write";
export { StoreSettingsError } from "./store-settings-write";
export {
  DEFAULT_STORE_SETTINGS,
  parseStoreSettings,
  type StoreSettings,
  type StoreSettingsSection,
} from "../../src/domain/store-settings-schema";
export type StoreSettingsRow = {
  settings: StoreSettings;
  updatedAt: Date | null;
  updatedByUserId: number | null;
};
export async function readStoreSettings(
  executor?: NativeDatabase
): Promise<StoreSettingsRow> {
  const [row] = await (executor ?? getNativeDb())
    .select()
    .from(storeSettings)
    .where(eq(storeSettings.id, 1))
    .limit(1);
  return row
    ? {
        settings: parseStoreSettings(row.data),
        updatedAt: row.updatedAt,
        updatedByUserId: row.updatedByUserId,
      }
    : {
        settings: DEFAULT_STORE_SETTINGS,
        updatedAt: null,
        updatedByUserId: null,
      };
}
export const getStoreSettings = cache(async (): Promise<StoreSettings> => {
  try {
    return (await readStoreSettings()).settings;
  } catch (error) {
    log.warn(
      "no se pudieron leer los ajustes de la tienda; van los de siempre",
      { error: mensajeDe(error) }
    );
    return DEFAULT_STORE_SETTINGS;
  }
});
export async function saveStoreSettingsSection(
  section: StoreSettingsSection,
  values: unknown,
  actor: { userId: number | null }
) {
  const result = await writeD1SettingsSection(
    getNativeDb(),
    section,
    values,
    actor
  );
  revalidatePath("/", "layout");
  return result;
}
export async function resetStoreSettingsSection(
  section: StoreSettingsSection,
  actor: { userId: number | null }
) {
  if (!Object.hasOwn(DEFAULT_STORE_SETTINGS, section))
    return saveStoreSettingsSection(section, {}, actor);
  const values =
    section === "paginas"
      ? Object.fromEntries(
          Object.keys(DEFAULT_STORE_SETTINGS.paginas).map((slug) => [
            slug,
            { activo: false, titulo: null, cuerpo: null },
          ])
        )
      : Object.fromEntries(
          Object.entries(DEFAULT_STORE_SETTINGS[section]).map(
            ([key, value]) => [
              key,
              key === "confianzaLineas" && value === null ? [] : value,
            ]
          )
        );
  return saveStoreSettingsSection(section, values, actor);
}
