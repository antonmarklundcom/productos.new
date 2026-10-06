"use server";

import { safeError } from "@/lib/safe-error";

import { headers } from "next/headers";

import { suggestProducts, type SearchSuggestion } from "@/db/queries";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Sugerencias del buscador mientras se escribe (PLAN.md FASE 2, PR N).
 *
 * **Pública y sin sesión**, como el resto de la vidriera: no expone nada que
 * `/buscar` no muestre ya. Igual va limitada por IP, y no por miedo a un
 * atacante sino por aritmética: cada tecla que se escapa del debounce es una
 * consulta `MATCH … AGAINST` contra el catálogo, y esto corre en el slot único
 * de Node de Hostinger junto con el checkout. Que un buscador nervioso pueda
 * hacerle la cola al pedido de alguien es un problema de plata.
 *
 * Nunca tira: sin resultados, con un término corto o pasado el límite devuelve
 * una lista vacía. Un typeahead que muestra un error es peor que uno que no
 * muestra nada — la persona sigue pudiendo apretar Enter y buscar de verdad.
 */
export async function sugerirProductos(
  term: unknown
): Promise<SearchSuggestion[]> {
  if (typeof term !== "string") return [];

  const cleaned = term.trim();
  if (cleaned.length < 2 || cleaned.length > 80) return [];

  const ip = clientIp(await headers());
  // 30 por minuto: con el debounce de 250 ms, escribir sin parar durante un
  // minuto entero da bastante menos que eso.
  if (
    !rateLimit(`buscar:sugerencias:${ip}`, { limit: 30, windowMs: 60_000 }).ok
  )
    return [];

  try {
    return await suggestProducts(cleaned);
  } catch (error) {
    // La base caída no puede romper el header de toda la tienda.
    console.error("sugerirProductos falló", safeError(error).message);
    return [];
  }
}
