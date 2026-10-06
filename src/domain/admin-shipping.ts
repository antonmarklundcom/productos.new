import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { MessageKey, Params } from '@/i18n';

import { DomainError } from './errors';

import { getDb } from '@/db';
import { shippingZones } from '@/db/schema';
import { t } from '@/i18n';
import { parseCityList } from '@/lib/city-list';
import { assertGs } from '@/lib/money';
import { slugify } from '@/lib/slug';

import type { Executor } from './executor';
import { normalizeCity } from './shipping';

/**
 * ABM de zonas de envío (PLAN.md FASE 2, PR K).
 *
 * `quoteShipping()` ya lee de esta tabla en cada checkout; lo que faltaba era
 * quién la escribe sin abrir un cliente de MySQL. Es la pantalla que más
 * rápido paga: el flete de una tienda paraguaya cambia con el combustible, y
 * hasta hoy cambiarlo era una llamada al desarrollador.
 *
 * **Todo lo de acá es plata**, así que valen las reglas del camino del dinero
 * (README §"Reglas no negociables"): los montos son enteros en guaraníes y
 * pasan por `assertGs`, y ninguna validación vive en el formulario.
 *
 * Tres reglas propias, y las tres salen de un modo concreto de perder plata:
 *
 * 1. **Una ciudad no puede estar en dos zonas.** `quoteShipping` se queda con
 *    la primera coincidencia por `position`, en silencio. Con "Luque" en dos
 *    zonas, el precio del flete depende de en qué orden quedaron las filas —
 *    y el dueño que corrigió el precio en la zona equivocada no se entera
 *    nunca. Acá es un error, con el nombre de la otra zona en el mensaje.
 *
 * 2. **Una zona sin ciudades es válida y es útil.** Nunca matchea exacto, así
 *    que sólo puede salir sorteada como "la más cara", que es justamente el
 *    comodín que hace falta: una zona *Interior* vacía y cara cubre todo lo
 *    que no esté nombrado. No se rechaza; la pantalla explica qué hace.
 *
 * 3. **No se puede apagar la última zona activa.** Sin zonas activas,
 *    `quoteShipping` devuelve `sin_zonas` con envío ₲0 — o sea, la tienda pasa
 *    a regalar el flete de todo el país sin que ningún cartel lo diga. Que una
 *    tienda recién clonada arranque así está bien (nunca cobró flete); que una
 *    que cobra ₲35.000 llegue ahí de un clic, no.
 */

export class AdminShippingError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = 'AdminShippingError';
  }
}

export type AdminShippingZoneRow = {
  id: number;
  slug: string;
  name: string;
  cities: string[];
  pricePyg: number;
  freeThresholdPyg: number | null;
  isActive: boolean;
  position: number;
};

function toRow(row: typeof shippingZones.$inferSelect): AdminShippingZoneRow {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    // La columna es JSON y una fila vieja o editada a mano puede traer
    // cualquier cosa. La pantalla no se puede romper por eso.
    cities: Array.isArray(row.cities) ? row.cities : [],
    pricePyg: row.pricePyg,
    freeThresholdPyg: row.freeThresholdPyg,
    isActive: row.isActive,
    position: row.position,
  };
}

/** Todas, activas e inactivas, en el orden en que las mira `quoteShipping`. */
export async function listAdminShippingZones(
  executor?: Executor,
): Promise<AdminShippingZoneRow[]> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select()
    .from(shippingZones)
    .orderBy(asc(shippingZones.position), asc(shippingZones.id));
  return rows.map(toRow);
}

export type ShippingZoneInput = {
  name: string;
  slug?: string | null;
  /** Una por línea o separadas por coma — la pantalla manda el texto crudo. */
  cities: string[];
  pricePyg: number;
  freeThresholdPyg: number | null;
};

type ZonaNormalizada = {
  name: string;
  slug: string;
  cities: string[];
  pricePyg: number;
  freeThresholdPyg: number | null;
};

function normalizar(input: ShippingZoneInput): ZonaNormalizada {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2) throw new AdminShippingError('adminError.envio.nombreCorto');
  if (name.length > 160) throw new AdminShippingError('adminError.envio.nombreLargo');

  const slug = slugify(input.slug?.trim() || name);
  if (slug.length === 0) {
    throw new AdminShippingError('adminError.envio.sinSlug');
  }
  if (slug.length > 120) throw new AdminShippingError('adminError.envio.slugLargo');

  // Se guarda la ciudad **como la escribió el dueño** —"Fernando de la Mora"
  // es lo que va a leer la compradora en el checkout— y se compara por su
  // forma normalizada. Guardar la normalizada arruinaría la pantalla; comparar
  // sin normalizar dejaría entrar "LUQUE" y "Luque" como dos ciudades.
  const vistas = new Map<string, string>();
  for (const raw of input.cities) {
    const city = raw.trim().replace(/\s+/g, ' ');
    if (city.length === 0) continue;
    if (city.length > 120) {
      throw new AdminShippingError('adminError.envio.ciudadLarga', {
        ciudad: city.slice(0, 30),
      });
    }
    // `set` a secas pisaría el valor: entre "LAMBARÉ" y "lambare" quedaría la
    // última, y lo que la compradora tiene que leer en el checkout es la
    // primera forma que el dueño escribió, no la que tipeó apurado al final.
    const key = normalizeCity(city);
    if (!vistas.has(key)) vistas.set(key, city);
  }
  const cities = [...vistas.values()];

  const pricePyg = exigirGuaranies(input.pricePyg, t('adminError.envio.precioLabel'));
  if (pricePyg < 0) throw new AdminShippingError('adminError.envio.precioNegativo');

  let freeThresholdPyg: number | null = null;
  if (input.freeThresholdPyg !== null) {
    freeThresholdPyg = exigirGuaranies(input.freeThresholdPyg, t('adminError.envio.umbralLabel'));
    if (freeThresholdPyg <= 0) {
      throw new AdminShippingError('adminError.envio.umbralCero');
    }
  }

  return { name, slug, cities, pricePyg, freeThresholdPyg };
}

/**
 * `assertGs` tira `MoneyError`, que es correcto adentro del dominio del dinero
 * y no sirve en un formulario: el dueño ve "monto debe ser un entero en
 * guaraníes, recibí 35000.5". Acá se traduce, sin dejar de validar.
 */
function exigirGuaranies(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new AdminShippingError('adminError.envio.noEsNumero', { campo: label });
  }
  if (!Number.isInteger(value)) {
    throw new AdminShippingError('adminError.envio.noEsEntero', { campo: label });
  }
  return assertGs(value, label);
}

/**
 * Ninguna ciudad de `cities` puede estar ya en otra zona.
 *
 * Se hace adentro de la transacción y con las filas bloqueadas: dos pestañas
 * agregando "Luque" a dos zonas distintas al mismo tiempo pasan las dos
 * validaciones si cada una mira la foto vieja, y el resultado es un flete que
 * depende del orden de las filas.
 */
async function exigirCiudadesLibres(
  tx: Executor,
  cities: string[],
  exceptZoneId: number | null,
): Promise<void> {
  if (cities.length === 0) return;

  const otras = await tx
    .select({ id: shippingZones.id, name: shippingZones.name, cities: shippingZones.cities })
    .from(shippingZones)
    .where(exceptZoneId === null ? undefined : ne(shippingZones.id, exceptZoneId))
    .for('update');

  const tomadas = new Map<string, string>();
  for (const zona of otras) {
    const lista = Array.isArray(zona.cities) ? zona.cities : [];
    for (const city of lista) tomadas.set(normalizeCity(city), zona.name);
  }

  for (const city of cities) {
    const dueña = tomadas.get(normalizeCity(city));
    if (dueña !== undefined) {
      throw new AdminShippingError('adminError.envio.ciudadRepetida', {
        ciudad: city,
        zona: dueña,
      });
    }
  }
}

export async function createShippingZone(
  input: ShippingZoneInput,
): Promise<AdminShippingZoneRow> {
  const zona = normalizar(input);

  return getDb().transaction(async (tx) => {
    const existing = await tx
      .select({ id: shippingZones.id })
      .from(shippingZones)
      .where(eq(shippingZones.slug, zona.slug))
      .limit(1);
    if (existing[0]) throw new AdminShippingError('adminError.envio.slugRepetido', { slug: zona.slug });

    await exigirCiudadesLibres(tx, zona.cities, null);

    const [ultima] = await tx
      .select({ n: sql<number>`COALESCE(MAX(${shippingZones.position}), -1)` })
      .from(shippingZones);

    await tx.insert(shippingZones).values({
      name: zona.name,
      slug: zona.slug,
      cities: zona.cities,
      pricePyg: zona.pricePyg,
      freeThresholdPyg: zona.freeThresholdPyg,
      position: Number(ultima?.n ?? -1) + 1,
    });

    const created = await tx
      .select()
      .from(shippingZones)
      .where(eq(shippingZones.slug, zona.slug))
      .limit(1);
    const row = created[0];
    if (!row) throw new AdminShippingError('adminError.envio.noPude');
    return toRow(row);
  });
}

/**
 * Editar precio, ciudades y umbral.
 *
 * **No toca los pedidos en vuelo**, y no hace falta hacer nada para eso: el
 * flete de un pedido quedó copiado en `orders.shipping_pyg` cuando se creó, y
 * `computeOrderTotals` lo recalcula server-side contra las zonas de *ese*
 * momento. Cambiar una zona cambia lo que se cotiza de acá en adelante, nunca
 * lo que alguien ya aceptó pagar.
 */
export async function updateShippingZone(input: {
  zoneId: number;
  data: ShippingZoneInput;
}): Promise<void> {
  const zona = normalizar(input.data);

  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(shippingZones)
      .where(eq(shippingZones.id, input.zoneId))
      .limit(1)
      .for('update');
    const actual = rows[0];
    if (!actual) throw new AdminShippingError('adminError.envio.noExiste');

    const choque = await tx
      .select({ id: shippingZones.id })
      .from(shippingZones)
      .where(and(eq(shippingZones.slug, zona.slug), ne(shippingZones.id, actual.id)))
      .limit(1);
    if (choque[0]) throw new AdminShippingError('adminError.envio.slugRepetidoOtra', { slug: zona.slug });

    await exigirCiudadesLibres(tx, zona.cities, actual.id);

    await tx
      .update(shippingZones)
      .set({
        name: zona.name,
        slug: zona.slug,
        cities: zona.cities,
        pricePyg: zona.pricePyg,
        freeThresholdPyg: zona.freeThresholdPyg,
      })
      .where(eq(shippingZones.id, actual.id));
  });
}

/**
 * Activar o desactivar. La regla 3 de la cabecera vive acá, adentro de la
 * transacción: dos pestañas apagando las dos últimas zonas a la vez pasan las
 * dos validaciones si cada una cuenta sobre la foto vieja.
 */
export async function setShippingZoneActive(input: {
  zoneId: number;
  isActive: boolean;
}): Promise<void> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(shippingZones)
      .where(eq(shippingZones.id, input.zoneId))
      .limit(1)
      .for('update');
    const zona = rows[0];
    if (!zona) throw new AdminShippingError('adminError.envio.noExiste');
    if (zona.isActive === input.isActive) return;

    if (!input.isActive) {
      const otras = await tx
        .select({ id: shippingZones.id })
        .from(shippingZones)
        .where(and(eq(shippingZones.isActive, true), ne(shippingZones.id, zona.id)))
        .for('update');

      if (otras.length === 0) {
        throw new AdminShippingError('adminError.envio.ultimaActiva');
      }
    }

    await tx.update(shippingZones).set({ isActive: input.isActive }).where(eq(shippingZones.id, zona.id));
  });
}

/**
 * Subir o bajar una zona.
 *
 * El orden importa más de lo que parece: `quoteShipping` recorre las zonas
 * activas por `position` y se queda con la primera que nombre la ciudad. Con
 * la regla de ciudades únicas eso es determinista, pero el orden sigue
 * decidiendo cuál es "la más cara" ante un empate de precio, y es el orden en
 * el que el dueño lee su propia tabla.
 *
 * Renumera todo a `0..n-1`, igual que las categorías y por el mismo motivo.
 */
export async function moveShippingZone(input: {
  zoneId: number;
  direction: 'up' | 'down';
}): Promise<void> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ id: shippingZones.id, position: shippingZones.position })
      .from(shippingZones)
      .orderBy(asc(shippingZones.position), asc(shippingZones.id))
      .for('update');

    const index = rows.findIndex((row) => row.id === input.zoneId);
    if (index === -1) throw new AdminShippingError('adminError.envio.noExiste');

    const target = input.direction === 'up' ? index - 1 : index + 1;
    if (target >= 0 && target < rows.length) {
      const moved = rows[index]!;
      rows[index] = rows[target]!;
      rows[target] = moved;
    }

    for (const [position, row] of rows.entries()) {
      if (row.position === position) continue;
      await tx.update(shippingZones).set({ position }).where(eq(shippingZones.id, row.id));
    }
  });
}

/**
 * Re-exportada de `@/lib/city-list`: quien trabaja con zonas la busca acá.
 * El formulario, que corre en el navegador, la importa de `lib` directo — ver
 * el comentario de ese archivo.
 */
export { parseCityList };
