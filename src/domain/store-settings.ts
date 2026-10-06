import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cache } from "react";

import { getDb } from "@/db";
import { storeSettings } from "@/db/schema";
import type { MessageKey, Params } from "@/i18n";
import { log, mensajeDe } from "@/lib/log";

import { DomainError } from "./errors";
import type { Executor } from "./executor";
import {
  DEFAULT_STORE_SETTINGS,
  SECTION_INPUT,
  StoreSettingsSchema,
  parseStoreSettings,
  type StoreSettings,
  type StoreSettingsSection,
} from "./store-settings-schema";

export {
  DEFAULT_STORE_SETTINGS,
  parseStoreSettings,
  type StoreSettings,
  type StoreSettingsSection,
} from "./store-settings-schema";

/**
 * Los ajustes de la tienda (`/admin/ajustes`): leer y guardar la fila única de
 * `store_settings`. La forma, los defaults y la precedencia viven en
 * `store-settings-schema.ts`, que es puro.
 *
 * Dos reglas, en este orden:
 *
 * 1. **La vidriera nunca se cae por un ajuste.** Sin fila, con la tabla
 *    todavía sin crear (una tienda que actualizó el código antes de migrar),
 *    con la base caída o con un JSON roto: `getStoreSettings()` devuelve los
 *    defaults y lo deja en el log. Los defaults son "lo de siempre", así que
 *    el peor caso es la tienda tal como estaba antes de esta tabla.
 * 2. **Guardar una sección no toca las otras.** El formulario de contacto no
 *    conoce la portada; si mandara el JSON entero, dos pestañas abiertas se
 *    pisarían la mitad de los ajustes. Se relee la fila con `FOR UPDATE`, se
 *    reemplaza esa sección y se escribe.
 */

export class StoreSettingsError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = "StoreSettingsError";
  }
}

/** Siempre `id = 1`, como `bank_details`. */
const SINGLETON_ID = 1;

export type StoreSettingsRow = {
  settings: StoreSettings;
  updatedAt: Date | null;
  updatedByUserId: number | null;
};

/** La fila cruda, parseada. Tira si la base tira: es para el panel y los tests. */
export async function readStoreSettings(
  executor?: Executor
): Promise<StoreSettingsRow> {
  const tx = executor ?? getDb();
  const [fila] = await tx
    .select()
    .from(storeSettings)
    .where(eq(storeSettings.id, SINGLETON_ID))
    .limit(1);

  if (!fila)
    return {
      settings: DEFAULT_STORE_SETTINGS,
      updatedAt: null,
      updatedByUserId: null,
    };
  return {
    settings: parseStoreSettings(fila.data),
    updatedAt: fila.updatedAt,
    updatedByUserId: fila.updatedByUserId,
  };
}

/**
 * Los ajustes efectivos para la vidriera. Nunca tira.
 *
 * `cache()` de React: una consulta por request aunque la pidan el layout, el
 * pie, la barra de anuncio y la página a la vez. Fuera de un render de React
 * (un script, el cron del resumen) no memoiza, y está bien.
 */
export const getStoreSettings = cache(async (): Promise<StoreSettings> => {
  try {
    return (await readStoreSettings()).settings;
  } catch (error) {
    log.warn(
      "no se pudieron leer los ajustes de la tienda; van los de siempre",
      {
        error: mensajeDe(error),
      }
    );
    return DEFAULT_STORE_SETTINGS;
  }
});

/**
 * Valida y guarda **una** sección. Upsert del singleton.
 *
 * `values` es lo que manda el formulario, sin validar: la validación es parte
 * de la escritura (mismo criterio que `admin-bank.ts`), no un paso previo que
 * alguien pueda saltearse.
 *
 * En `paginas` el formulario manda una página por vez, así que se funde
 * página por página; en el resto, la sección entera se reemplaza.
 */
export async function saveStoreSettingsSection(
  section: StoreSettingsSection,
  values: unknown,
  actor: { userId: number | null }
): Promise<StoreSettings> {
  const schema = SECTION_INPUT[section];
  if (!schema) throw new StoreSettingsError("adminError.ajustes.seccion");

  const parsed = schema.safeParse(values ?? {});
  if (!parsed.success) {
    throw new StoreSettingsError("adminError.ajustes.invalido", {
      detalle: parsed.error.issues[0]?.message ?? "",
    });
  }

  const guardado = await getDb().transaction(async (tx) => {
    const [fila] = await tx
      .select({ data: storeSettings.data })
      .from(storeSettings)
      .where(eq(storeSettings.id, SINGLETON_ID))
      .limit(1)
      .for("update");

    const actual = fila
      ? parseStoreSettings(fila.data)
      : DEFAULT_STORE_SETTINGS;
    const nuevaSeccion =
      section === "paginas"
        ? {
            ...actual.paginas,
            ...definidos(parsed.data as Record<string, unknown>),
          }
        : parsed.data;

    // Se vuelve a pasar por el schema de lectura: lo que queda en la base es
    // siempre algo que la vidriera sabe leer.
    const siguiente = StoreSettingsSchema.parse({
      ...actual,
      [section]: nuevaSeccion,
    });

    if (fila) {
      await tx
        .update(storeSettings)
        .set({ data: siguiente, updatedByUserId: actor.userId })
        .where(eq(storeSettings.id, SINGLETON_ID));
    } else {
      await tx
        .insert(storeSettings)
        .values({
          id: SINGLETON_ID,
          data: siguiente,
          updatedByUserId: actor.userId,
        });
    }
    return siguiente;
  });

  revalidarVidriera();
  return guardado;
}

/** Vuelve una sección entera a sus valores por defecto. */
export async function resetStoreSettingsSection(
  section: StoreSettingsSection,
  actor: { userId: number | null }
): Promise<StoreSettings> {
  const porDefecto =
    section === "paginas"
      ? Object.fromEntries(
          Object.keys(DEFAULT_STORE_SETTINGS.paginas).map((slug) => [
            slug,
            { activo: false, titulo: null, cuerpo: null },
          ])
        )
      : sinNulosDeTexto(DEFAULT_STORE_SETTINGS[section]);
  return saveStoreSettingsSection(section, porDefecto, actor);
}

/**
 * La portada, las páginas y la barra se dibujan en el layout raíz: hay que
 * tirar la caché de ISR de todo el sitio, no de una ruta.
 */
function revalidarVidriera(): void {
  revalidatePath("/", "layout");
}

function definidos(objeto: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(objeto).filter(([, valor]) => valor !== undefined)
  );
}

/**
 * Los defaults de lectura tienen `null` en listas y textos; el schema de
 * escritura acepta `null` en textos pero espera un array en las líneas.
 */
function sinNulosDeTexto(valor: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(valor).map(([clave, v]) => [
      clave,
      clave === "confianzaLineas" && v === null ? [] : v,
    ])
  );
}
