/**
 * Medición por tienda: GA4 y/o Meta Pixel, desde el panel o el entorno.
 *
 * "Vender más" empieza por saber qué pasa: cuánta gente entra, desde dónde,
 * y cuántos de los que llegan al checkout terminan comprando. Sin medición,
 * cada cambio de diseño o campaña es una corazonada.
 *
 * Dos decisiones:
 *
 * - **Apagado por defecto.** Sin las variables, la tienda no carga ni un byte
 *   de terceros — exactamente como hasta ahora. Prenderlo es una decisión por
 *   tienda (NEW-STORE.md §4), no algo que se hereda del template.
 * - **El formato se valida con lupa.** Estos valores terminan interpolados en
 *   un `<script>` de la página: un id con formato raro no se degrada a "se
 *   carga igual", se descarta. Eso convierte un env var escrito por cualquiera
 *   con acceso al hPanel en algo que no puede inyectar JS — y de paso agarra
 *   el clásico de pegar la URL entera en vez del id.
 *
 * Los ids no son secretos (viajan en el HTML de cualquier sitio que mida),
 * por eso el prefijo `NEXT_PUBLIC_` acá es correcto y no una fuga.
 */

import { integracion } from "./integraciones";

/** `G-XXXXXXXXXX` — el "ID de medición" de un flujo web de GA4. */
const GA4_ID_RE = /^G-[A-Z0-9]{4,20}$/;

/** El id numérico del pixel de Meta (Facebook/Instagram). */
const META_PIXEL_ID_RE = /^[0-9]{5,20}$/;

export type AnalyticsConfig = {
  ga4Id: string | null;
  metaPixelId: string | null;
};

/**
 * Los medidores con formato válido.
 *
 * Sin argumento lee la config efectiva: `/admin/integraciones` → Medición, o
 * si no `NEXT_PUBLIC_GA4_ID` / `NEXT_PUBLIC_META_PIXEL_ID`
 * (`src/lib/integraciones.ts`). Con `env`, sólo ese objeto — es lo que usan
 * los tests. El regex vale igual para las dos fuentes: un id cargado desde el
 * panel tampoco puede inyectar JS.
 */
export function analyticsConfig(env?: Record<string, string | undefined>): AnalyticsConfig {
  const efectiva = env === undefined ? integracion("analitica").valores : null;
  const ga4 = (efectiva ? efectiva.ga4Id ?? "" : env?.NEXT_PUBLIC_GA4_ID ?? "").trim();
  const pixel = (efectiva ? efectiva.metaPixelId ?? "" : env?.NEXT_PUBLIC_META_PIXEL_ID ?? "").trim();

  return {
    ga4Id: GA4_ID_RE.test(ga4) ? ga4 : null,
    metaPixelId: META_PIXEL_ID_RE.test(pixel) ? pixel : null,
  };
}

/** ¿Hay al menos un medidor configurado y con formato válido? */
export function analyticsActivo(env?: Record<string, string | undefined>): boolean {
  const config = analyticsConfig(env);
  return config.ga4Id !== null || config.metaPixelId !== null;
}
