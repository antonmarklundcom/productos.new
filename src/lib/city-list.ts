/**
 * El textarea de ciudades de `/admin/envios`, convertido en lista.
 *
 * Vive en `src/lib` y no en `src/domain/admin-shipping.ts` por una razón de
 * bundle, no de estilo: el formulario es un componente cliente y necesita
 * contar las ciudades mientras el dueño escribe. Importarla del dominio le
 * arrastra al navegador `src/db/index.ts` entero —o sea `mysql2`— y el build
 * de Next falla. Acá no hay ninguna dependencia.
 *
 * Acepta una ciudad por línea, separadas por coma o por punto y coma, o las
 * tres cosas mezcladas: es lo que sale de pegar una lista de un WhatsApp o de
 * una planilla, y pedirle al dueño un formato exacto es pedirle que falle.
 */
export function parseCityList(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((city) => city.trim())
    .filter((city) => city.length > 0);
}
