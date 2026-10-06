import { TIENDA } from "@/config/tienda";
import { getStoreSettings } from "@/domain/store-settings";
import { nombreEfectivo, variablesDeColor } from "@/domain/store-settings-schema";
import { productImageUrl } from "@/lib/images";

/**
 * La identidad **efectiva** de la tienda: lo que el dueño cargó en
 * `/admin/ajustes` → Identidad, y si no, lo de `src/config/tienda.ts` y el
 * tema de `globals.css`. Una tienda que nunca abrió esa sección se ve igual
 * que antes.
 *
 * Async porque toca la base, pero una vez por request: `getStoreSettings`
 * está memoizado con `cache()` y nunca tira (sin base, van los defaults).
 * Los componentes cliente reciben estos valores ya resueltos por prop.
 */

export type MarcaEfectiva = {
  nombre: string;
  /** URL pública del logo, o `null` (el header muestra el nombre en texto). */
  logoUrl: string | null;
  /** URL pública del favicon, o `null` (queda `src/app/favicon.ico`). */
  faviconUrl: string | null;
  /** Variables CSS del color de marca, o `null` (manda el tema). */
  variablesColor: Record<string, string> | null;
};

export async function marcaEfectiva(): Promise<MarcaEfectiva> {
  const { identidad } = await getStoreSettings();
  return {
    nombre: nombreEfectivo(identidad, TIENDA.nombre),
    logoUrl: productImageUrl(identidad.logoId, "logo"),
    faviconUrl: productImageUrl(identidad.faviconId, "favicon"),
    variablesColor: variablesDeColor(identidad),
  };
}

/** Sólo el nombre: el caso más común (títulos, mensajes, remito). */
export async function nombreTienda(): Promise<string> {
  const { identidad } = await getStoreSettings();
  return nombreEfectivo(identidad, TIENDA.nombre);
}
