import { TIENDA } from "@/config/tienda";
import { getStoreSettings } from "@/domain/store-settings";
import { cuentasEfectivas } from "@/domain/store-settings-schema";

/**
 * El único lugar que decide si las cuentas de cliente existen.
 *
 * Lo decide el dueño en `/admin/ajustes` → Cuentas de cliente; si nunca lo
 * tocó, manda `TIENDA.cuentasClientes` de `src/config/tienda.ts` (apagado de
 * fábrica). Una función con este nombre exacto porque hay tests de CI
 * (`flags-apagados.test.ts`) que verifican que **toda** ruta, componente y
 * acción de `/cuenta` pase por acá antes de tocar nada.
 *
 * **Async**: siempre con `await`. Un `if (!cuentasClientesHabilitadas())`
 * sin await sería una promesa, que siempre es "verdadera" — TypeScript lo
 * marca como error (TS2801), y por eso no puede pasar a CI.
 */
export async function cuentasClientesHabilitadas(): Promise<boolean> {
  const { cuentas } = await getStoreSettings();
  return cuentasEfectivas(cuentas, TIENDA.cuentasClientes);
}
