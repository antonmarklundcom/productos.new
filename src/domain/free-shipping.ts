/**
 * "Te faltan ₲X para el envío gratis".
 *
 * El umbral vive en `shipping_zones.free_threshold_pyg`, que es **nullable** y
 * **por zona**. O sea que antes de que la compradora ponga su ciudad puede no
 * haber ningún número verdadero que mostrarle, y mostrar uno igual —el de la
 * zona más barata, digamos— es prometer un envío gratis que después no se le
 * hace. Por eso esto devuelve un estado y no un número: cada estado tiene su
 * frase, e "indefinido" es un estado de primera clase, no un caso borde.
 *
 * Nada de acá cobra: el envío que se cobra sale de `quoteShipping` contra la
 * DB, adentro de la transacción que crea el pedido.
 */

/** Lo único que se necesita de una zona para esta cuenta. */
export type FreeShippingZone = { freeThresholdPyg: number | null };

export type FreeShippingProgress =
  /** Ninguna zona regala el envío: no hay nada que decir. */
  | { kind: "sin_umbral" }
  /** Ya lo alcanzó, con la ciudad puesta o porque todas las zonas coinciden. */
  | { kind: "alcanzado"; thresholdPyg: number }
  /** Falta esto, y el número es exacto para su zona. */
  | { kind: "falta"; thresholdPyg: number; missingPyg: number }
  /**
   * Todavía no sabemos la zona y las zonas no coinciden entre sí. El número
   * es el umbral **más bajo** que existe, y la copia tiene que decir "en
   * algunas zonas": es lo máximo que se puede afirmar sin ciudad.
   */
  | { kind: "indefinido"; thresholdPyg: number; missingPyg: number };

/** Progreso contra la zona ya resuelta — el caso con ciudad puesta. */
export function freeShippingForZone(
  zone: FreeShippingZone | null,
  subtotalPyg: number
): FreeShippingProgress {
  const threshold = zone?.freeThresholdPyg ?? null;
  if (threshold === null) return { kind: "sin_umbral" };
  if (subtotalPyg >= threshold) return { kind: "alcanzado", thresholdPyg: threshold };
  return { kind: "falta", thresholdPyg: threshold, missingPyg: threshold - subtotalPyg };
}

/**
 * Progreso sin ciudad — el carrito, antes del checkout.
 *
 * Sólo se afirma un número exacto cuando **todas** las zonas activas tienen el
 * mismo umbral: ahí la ciudad no cambia la respuesta y la frase es honesta.
 * Si alguna zona no regala el envío, el conjunto ya no es uniforme aunque las
 * demás coincidan, y se cae a "indefinido".
 */
export function freeShippingWithoutZone(
  zones: readonly FreeShippingZone[],
  subtotalPyg: number
): FreeShippingProgress {
  const thresholds = zones
    .map((zone) => zone.freeThresholdPyg)
    .filter((value): value is number => value !== null);

  if (thresholds.length === 0) return { kind: "sin_umbral" };

  const lowest = Math.min(...thresholds);
  const uniforme =
    thresholds.length === zones.length && thresholds.every((value) => value === lowest);

  if (uniforme) return freeShippingForZone({ freeThresholdPyg: lowest }, subtotalPyg);

  // Con umbrales distintos, lo único cierto es el más bajo, y sólo "en
  // algunas zonas". `alcanzado` no se usa acá: haber pasado el umbral más
  // barato no garantiza nada en la zona que termine eligiendo.
  return {
    kind: "indefinido",
    thresholdPyg: lowest,
    missingPyg: Math.max(0, lowest - subtotalPyg),
  };
}
