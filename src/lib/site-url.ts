/**
 * Origen público del sitio, leído de `NEXT_PUBLIC_SITE_URL`.
 *
 * Existe por las tarjetas de Open Graph: WhatsApp y Facebook necesitan la URL
 * **absoluta** de la imagen, y una ruta relativa como `/opengraph-image` no
 * les dice nada. Next resuelve esas rutas contra `metadataBase`, así que sin
 * esta variable la tienda comparte links sin foto aunque la foto exista.
 *
 * Devuelve `null` —y no un dominio inventado— si falta o no parsea: mejor que
 * Next avise en el build a que la tienda publique links apuntando al lugar
 * equivocado. Es la única variable `NEXT_PUBLIC_` del proyecto (ver
 * `tests/unit/security-review.test.ts`).
 */
export function siteOrigin(): URL | null {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
