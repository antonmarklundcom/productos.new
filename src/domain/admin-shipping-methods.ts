import { and, asc, eq, ne, sql } from 'drizzle-orm';

import { getDb } from '@/db';
import {
  PAYMENT_METHODS,
  shippingMethods,
  shippingZones,
  type PaymentMethod,
  type ShippingMethodKind,
  type ShippingMethodPricing,
} from '@/db/schema';
import type { MessageKey, Params } from '@/i18n';
import { t } from '@/i18n';
import { assertGs } from '@/lib/money';
import { slugify } from '@/lib/slug';

import { DomainError } from './errors';
import type { Executor } from './executor';

/**
 * ABM de métodos de envío (FASE 3).
 *
 * La tabla de zonas contesta *cuánto sale llegar a esa ciudad*. Ésta contesta
 * la pregunta que faltaba: **de qué formas se entrega, y con cuáles de ellas
 * se puede pagar al recibir.** Antes "contra entrega" era una opción del
 * pedido, suelta, ofrecida en todo el país — incluido el interior, donde nadie
 * del comercio va a estar en la puerta para cobrar.
 *
 * Es plata, así que valen las reglas del camino del dinero: montos enteros en
 * guaraníes por `assertGs`, y ninguna validación vive en el formulario. Owner
 * only, igual que las zonas y por el mismo motivo: un método mal configurado
 * cobra de menos —o promete una entrega que no existe— en cada pedido, en
 * silencio, hasta que alguien mira.
 *
 * Cuatro reglas propias:
 *
 * 1. **`retiro` no viaja: cuesta ₲0 y no tiene zonas.** Se normaliza acá y no
 *    se le pide al dueño que lo entienda: si elige "Retiro en local", el
 *    precio fijo queda en 0 y la lista de zonas vacía, pase lo que pase el
 *    formulario.
 * 2. **`pricing = 'fijo'` exige su precio; `'zona'` lo borra.** Un método por
 *    zona con un `fixed_price_pyg` viejo colgado es una tarifa fantasma
 *    esperando a que alguien cambie el desplegable.
 * 3. **`allowedPaymentMethods` nunca vacío.** Un método que no acepta ninguna
 *    forma de pago no se puede elegir: sería una opción que rebota al
 *    confirmar, sin decir por qué.
 * 4. **Las zonas declaradas tienen que existir.** Un id de una zona borrada
 *    hace que el método deje de aparecer en ciudades donde el dueño cree que
 *    aparece, y nada en la pantalla lo diría.
 *
 * Lo que **no** hay acá, a diferencia de las zonas, es la regla de "la última
 * activa": quedarse sin métodos es un estado legítimo y es donde arranca toda
 * tienda clonada — `quoteShippingMethods` devuelve el método implícito con el
 * precio de la zona, o sea el checkout de siempre. Apagar el último método no
 * regala nada; sólo vuelve al comportamiento anterior.
 */

export class AdminShippingMethodError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = 'AdminShippingMethodError';
  }
}

export type AdminShippingMethodRow = {
  id: number;
  slug: string;
  name: string;
  kind: ShippingMethodKind;
  pricing: ShippingMethodPricing;
  fixedPricePyg: number | null;
  zoneIds: number[];
  allowedPaymentMethods: PaymentMethod[];
  description: string | null;
  isActive: boolean;
  position: number;
};

function toRow(row: typeof shippingMethods.$inferSelect): AdminShippingMethodRow {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    pricing: row.pricing,
    fixedPricePyg: row.fixedPricePyg,
    // Las dos columnas son JSON y una fila vieja o editada a mano puede traer
    // cualquier cosa. La pantalla no se puede romper por eso.
    zoneIds: Array.isArray(row.zoneIds) ? row.zoneIds.map(Number).filter(Number.isInteger) : [],
    allowedPaymentMethods: PAYMENT_METHODS.filter((method) =>
      Array.isArray(row.allowedPaymentMethods) ? row.allowedPaymentMethods.includes(method) : false,
    ),
    description: row.description,
    isActive: row.isActive,
    position: row.position,
  };
}

/** Todos, activos e inactivos, en el orden en que los mira el checkout. */
export async function listAdminShippingMethods(
  executor?: Executor,
): Promise<AdminShippingMethodRow[]> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select()
    .from(shippingMethods)
    .orderBy(asc(shippingMethods.position), asc(shippingMethods.id));
  return rows.map(toRow);
}

export type ShippingMethodInput = {
  name: string;
  slug?: string | null;
  kind: ShippingMethodKind;
  pricing: ShippingMethodPricing;
  /** Sólo se usa con `pricing = 'fijo'`. */
  fixedPricePyg: number | null;
  /** Vacío = todas las zonas activas. */
  zoneIds: number[];
  allowedPaymentMethods: PaymentMethod[];
  description?: string | null;
};

type MetodoNormalizado = {
  name: string;
  slug: string;
  kind: ShippingMethodKind;
  pricing: ShippingMethodPricing;
  fixedPricePyg: number | null;
  zoneIds: number[];
  allowedPaymentMethods: PaymentMethod[];
  description: string | null;
};

/**
 * `assertGs` tira `MoneyError`, correcto adentro del dominio del dinero y
 * inútil en un formulario. Acá se traduce, sin dejar de validar — igual que en
 * el ABM de zonas.
 */
function exigirGuaranies(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new AdminShippingMethodError('adminError.metodo.noEsNumero', { campo: label });
  }
  if (!Number.isInteger(value)) {
    throw new AdminShippingMethodError('adminError.metodo.noEsEntero', { campo: label });
  }
  return assertGs(value, label);
}

function normalizar(input: ShippingMethodInput): MetodoNormalizado {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2) throw new AdminShippingMethodError('adminError.metodo.nombreCorto');
  if (name.length > 160) throw new AdminShippingMethodError('adminError.metodo.nombreLargo');

  const slug = slugify(input.slug?.trim() || name);
  if (slug.length === 0) throw new AdminShippingMethodError('adminError.metodo.sinSlug');
  if (slug.length > 120) throw new AdminShippingMethodError('adminError.metodo.slugLargo');

  const description = input.description?.trim().replace(/\s+/g, ' ') || null;
  if (description !== null && description.length > 200) {
    throw new AdminShippingMethodError('adminError.metodo.descripcionLarga');
  }

  // Los medios de pago se filtran contra el enum en vez de confiar en el
  // orden que mandó la pantalla: así la lista guardada siempre se lee igual.
  const allowedPaymentMethods = PAYMENT_METHODS.filter((method) =>
    input.allowedPaymentMethods.includes(method),
  );
  if (allowedPaymentMethods.length === 0) {
    throw new AdminShippingMethodError('adminError.metodo.sinPagos');
  }

  // Regla 1: retiro en local no viaja a ningún lado. No se le pide al dueño
  // que deje los campos coherentes — se dejan coherentes acá.
  if (input.kind === 'retiro') {
    return {
      name,
      slug,
      kind: 'retiro',
      pricing: 'fijo',
      fixedPricePyg: 0,
      zoneIds: [],
      allowedPaymentMethods,
      description,
    };
  }

  let fixedPricePyg: number | null = null;
  if (input.pricing === 'fijo') {
    if (input.fixedPricePyg === null || input.fixedPricePyg === undefined) {
      throw new AdminShippingMethodError('adminError.metodo.faltaPrecioFijo');
    }
    fixedPricePyg = exigirGuaranies(input.fixedPricePyg, t('adminError.metodo.precioLabel'));
    if (fixedPricePyg < 0) throw new AdminShippingMethodError('adminError.metodo.precioNegativo');
  }

  // Sin duplicados y en orden estable: la lista es una clave de comparación,
  // no un historial de en qué orden fue tildando las casillas.
  const zoneIds = [...new Set(input.zoneIds.filter(Number.isInteger))].sort((a, b) => a - b);
  if (zoneIds.length > 200) throw new AdminShippingMethodError('adminError.metodo.demasiadasZonas');

  return {
    name,
    slug,
    kind: input.kind,
    pricing: input.pricing,
    fixedPricePyg,
    zoneIds,
    allowedPaymentMethods,
    description,
  };
}

/**
 * Regla 4: toda zona declarada existe.
 *
 * Adentro de la transacción, como todo lo demás: entre el `select` de la
 * pantalla y el submit alguien pudo borrar la zona, y guardar un id muerto
 * hace que el método deje de ofrecerse en ciudades donde el dueño jura que se
 * ofrece.
 */
async function exigirZonasExistentes(tx: Executor, zoneIds: number[]): Promise<void> {
  if (zoneIds.length === 0) return;

  const rows = await tx.select({ id: shippingZones.id }).from(shippingZones);
  const existen = new Set(rows.map((row) => row.id));
  const faltan = zoneIds.filter((id) => !existen.has(id));
  if (faltan.length > 0) {
    throw new AdminShippingMethodError('adminError.metodo.zonaInexistente', {
      ids: faltan.join(', '),
    });
  }
}

export async function createShippingMethod(
  input: ShippingMethodInput,
): Promise<AdminShippingMethodRow> {
  const metodo = normalizar(input);

  return getDb().transaction(async (tx) => {
    const existing = await tx
      .select({ id: shippingMethods.id })
      .from(shippingMethods)
      .where(eq(shippingMethods.slug, metodo.slug))
      .limit(1);
    if (existing[0]) {
      throw new AdminShippingMethodError('adminError.metodo.slugRepetido', { slug: metodo.slug });
    }

    await exigirZonasExistentes(tx, metodo.zoneIds);

    const [ultima] = await tx
      .select({ n: sql<number>`COALESCE(MAX(${shippingMethods.position}), -1)` })
      .from(shippingMethods);

    await tx.insert(shippingMethods).values({
      name: metodo.name,
      slug: metodo.slug,
      kind: metodo.kind,
      pricing: metodo.pricing,
      fixedPricePyg: metodo.fixedPricePyg,
      zoneIds: metodo.zoneIds,
      allowedPaymentMethods: metodo.allowedPaymentMethods,
      description: metodo.description,
      position: Number(ultima?.n ?? -1) + 1,
    });

    const created = await tx
      .select()
      .from(shippingMethods)
      .where(eq(shippingMethods.slug, metodo.slug))
      .limit(1);
    const row = created[0];
    if (!row) throw new AdminShippingMethodError('adminError.metodo.noPude');
    return toRow(row);
  });
}

/**
 * Editar un método.
 *
 * **No toca los pedidos en vuelo**, igual que las zonas y por lo mismo: el
 * flete quedó copiado en `orders.shipping_pyg` y el nombre del método en
 * `orders.shipping_method_name` cuando se creó cada pedido. Cambiar un método
 * cambia lo que se cotiza de acá en adelante, nunca lo que alguien ya aceptó
 * pagar ni cómo se le dijo que iba a recibirlo.
 */
export async function updateShippingMethod(input: {
  methodId: number;
  data: ShippingMethodInput;
}): Promise<void> {
  const metodo = normalizar(input.data);

  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(shippingMethods)
      .where(eq(shippingMethods.id, input.methodId))
      .limit(1)
      .for('update');
    const actual = rows[0];
    if (!actual) throw new AdminShippingMethodError('adminError.metodo.noExiste');

    const choque = await tx
      .select({ id: shippingMethods.id })
      .from(shippingMethods)
      .where(and(eq(shippingMethods.slug, metodo.slug), ne(shippingMethods.id, actual.id)))
      .limit(1);
    if (choque[0]) {
      throw new AdminShippingMethodError('adminError.metodo.slugRepetidoOtro', {
        slug: metodo.slug,
      });
    }

    await exigirZonasExistentes(tx, metodo.zoneIds);

    await tx
      .update(shippingMethods)
      .set({
        name: metodo.name,
        slug: metodo.slug,
        kind: metodo.kind,
        pricing: metodo.pricing,
        fixedPricePyg: metodo.fixedPricePyg,
        zoneIds: metodo.zoneIds,
        allowedPaymentMethods: metodo.allowedPaymentMethods,
        description: metodo.description,
      })
      .where(eq(shippingMethods.id, actual.id));
  });
}

/**
 * Activar o desactivar.
 *
 * Sin la regla de "la última activa" que sí tienen las zonas: quedarse sin
 * métodos activos devuelve la tienda al checkout implícito de siempre, que es
 * un estado válido y no una forma de regalar el flete (ver la cabecera).
 */
export async function setShippingMethodActive(input: {
  methodId: number;
  isActive: boolean;
}): Promise<void> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(shippingMethods)
      .where(eq(shippingMethods.id, input.methodId))
      .limit(1)
      .for('update');
    const metodo = rows[0];
    if (!metodo) throw new AdminShippingMethodError('adminError.metodo.noExiste');
    if (metodo.isActive === input.isActive) return;

    await tx
      .update(shippingMethods)
      .set({ isActive: input.isActive })
      .where(eq(shippingMethods.id, metodo.id));
  });
}

/**
 * Subir o bajar un método.
 *
 * El orden es el que ve la compradora en el checkout, y además decide cuál se
 * usa cuando el navegador no eligió ninguno (`selectShippingMethod` toma el
 * primero). Renumera todo a `0..n-1`, igual que las zonas y las categorías.
 */
export async function moveShippingMethod(input: {
  methodId: number;
  direction: 'up' | 'down';
}): Promise<void> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ id: shippingMethods.id, position: shippingMethods.position })
      .from(shippingMethods)
      .orderBy(asc(shippingMethods.position), asc(shippingMethods.id))
      .for('update');

    const index = rows.findIndex((row) => row.id === input.methodId);
    if (index === -1) throw new AdminShippingMethodError('adminError.metodo.noExiste');

    const target = input.direction === 'up' ? index - 1 : index + 1;
    if (target >= 0 && target < rows.length) {
      const moved = rows[index]!;
      rows[index] = rows[target]!;
      rows[target] = moved;
    }

    for (const [position, row] of rows.entries()) {
      if (row.position === position) continue;
      await tx.update(shippingMethods).set({ position }).where(eq(shippingMethods.id, row.id));
    }
  });
}

/**
 * Métodos activos que no aplican a ninguna zona activa.
 *
 * **Pura**: recibe las dos listas y no toca la base, para que la pueda usar
 * tanto el panel como `pnpm preflight` (que se corre en el servidor de
 * producción y no se conecta a nada por su cuenta).
 *
 * Es un agujero silencioso: el método está prendido, se ve prendido en el
 * panel, y no aparece nunca en el checkout porque todas las zonas que declara
 * están apagadas o borradas. La compradora no ve un error — ve una opción
 * menos, o ninguna.
 *
 * Sólo entran los métodos que **declaran** zonas y no tienen ninguna activa.
 * `retiro` no depende de zonas por diseño, y un método con la lista vacía
 * significa "todas las zonas activas": los dos se ofrecen siempre, así que
 * nombrarlos acá sería ruido.
 */
export function shippingMethodsWithoutZones(
  methods: readonly Pick<AdminShippingMethodRow, 'name' | 'kind' | 'zoneIds' | 'isActive'>[],
  activeZoneIds: readonly number[],
): string[] {
  const activas = new Set(activeZoneIds);

  return methods
    .filter((method) => method.isActive && method.kind !== 'retiro')
    .filter(
      (method) =>
        method.zoneIds.length > 0 && !method.zoneIds.some((id) => activas.has(id)),
    )
    .map((method) => method.name);
}
