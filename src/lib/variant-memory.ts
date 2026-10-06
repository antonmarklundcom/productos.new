"use client";

/**
 * Recuerda qué variante venía eligiendo la compradora en cada producto.
 *
 * Es **sólo una comodidad de la vidriera**: quien siempre compra el mismo
 * talle no tiene que volver a buscarlo en cada visita. No decide nada más.
 * El id guardado únicamente puede preseleccionar una de las variantes que el
 * servidor ya dibujó, y sólo si sigue teniendo stock; el precio, la
 * disponibilidad y todo lo que se cobra siguen saliendo de la DB (ARCH.md §1
 * regla 1). Un localStorage adulterado, en el peor caso, marca un botón.
 */

const KEY = "tienda-py-variante";
/** Se guardan los últimos productos y nada más: esto vive en el navegador. */
const MAX_ENTRIES = 30;

type Memory = Record<string, number>;

function read(): Memory {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const memory: Memory = {};
    for (const [slug, id] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id === "number" && Number.isInteger(id) && id > 0) memory[slug] = id;
    }
    return memory;
  } catch {
    // Safari en modo privado tira al leer/escribir. Sin memoria se sigue
    // comprando igual: es la definición de una comodidad.
    return {};
  }
}

/** `null` si no hay nada guardado para ese producto. */
export function recallVariant(productSlug: string): number | null {
  return read()[productSlug] ?? null;
}

export function rememberVariant(productSlug: string, variantId: number): void {
  if (typeof window === "undefined") return;
  try {
    const memory = read();
    // Se reescribe la clave para que quede última: así el recorte de abajo
    // descarta lo más viejo y no lo que se acaba de usar.
    delete memory[productSlug];
    const entries = [...Object.entries(memory), [productSlug, variantId] as const].slice(
      -MAX_ENTRIES
    );
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Ídem: no guardar no rompe nada.
  }
}
