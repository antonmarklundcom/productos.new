import { asc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import {
  PAYMENT_METHODS,
  shippingMethods,
  shippingZones,
  type PaymentMethod,
  type ShippingMethodKind,
  type ShippingMethodPricing,
} from "@/db/schema";
import { t } from "@/i18n";

import type { Executor } from "./executor";

/**
 * Envío por zona. El precio sale de `shipping_zones`, nunca del navegador.
 *
 * El flete está gravado con IVA 10% incluido, igual que el precio de góndola.
 * Es el tratamiento habitual en PY; conviene confirmarlo con el contador del
 * comercio antes de emitir facturas legales (fase 2).
 */
export const SHIPPING_IVA_RATE = 10;

export type ShippingQuote = {
  zoneId: number | null;
  zoneName: string;
  shippingPyg: number;
  isFree: boolean;
  /**
   * De dónde salió el precio. No cambia lo que se cobra —eso ya está decidido
   * arriba— pero la pantalla dice cosas distintas en cada caso, y son tres, no
   * dos:
   *
   * - `exacta`: la ciudad cayó en una zona. Se puede nombrar.
   * - `mas_cara`: no cayó en ninguna y se cobró la tarifa más alta por
   *   descarte. Hay que avisarlo: el nombre de esa zona no significa nada
   *   para quien compra.
   * - `sin_zonas`: la tienda todavía no configuró zonas, así que el envío es
   *   ₲0 de verdad. Antes esto se mezclaba con `mas_cara` y el checkout
   *   mostraba "Gratis" y "te cobramos la tarifa más alta" en la misma
   *   pantalla — el estado en el que sale toda tienda recién clonada.
   */
  match: "exacta" | "mas_cara" | "sin_zonas";
  /** Umbral de envío gratis de la zona elegida. NULL = la zona no lo ofrece. */
  freeThresholdPyg: number | null;
};

/** Ciudad sin acentos, sin dobles espacios y en minúsculas. */
export function normalizeCity(city: string): string {
  return city
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cotiza el envío para una ciudad y un subtotal.
 *
 * Si la ciudad no cae en ninguna zona, usa la más cara: cobrar de menos por
 * un pueblo que no está en la lista sale del bolsillo del comercio.
 */
export async function quoteShipping(
  city: string,
  subtotalPyg: number,
  executor?: Executor
): Promise<ShippingQuote> {
  const tx = executor ?? getDb();
  const zones = await tx
    .select()
    .from(shippingZones)
    .where(eq(shippingZones.isActive, true))
    .orderBy(asc(shippingZones.position));

  if (zones.length === 0) {
    return {
      zoneId: null,
      zoneName: "Sin zonas configuradas",
      shippingPyg: 0,
      isFree: true,
      match: "sin_zonas",
      freeThresholdPyg: null,
    };
  }

  const target = normalizeCity(city);
  const found = zones.find((zone) =>
    zone.cities.some((name) => normalizeCity(name) === target)
  );
  const zone =
    found ??
    zones.reduce(
      (worst, item) => (item.pricePyg > worst.pricePyg ? item : worst),
      zones[0]!
    );

  const isFree =
    zone.freeThresholdPyg !== null && subtotalPyg >= zone.freeThresholdPyg;

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    shippingPyg: isFree ? 0 : zone.pricePyg,
    isFree,
    match: found !== undefined ? "exacta" : "mas_cara",
    freeThresholdPyg: zone.freeThresholdPyg,
  };
}

export async function listShippingZones(executor?: Executor) {
  const tx = executor ?? getDb();
  return tx
    .select()
    .from(shippingZones)
    .where(eq(shippingZones.isActive, true))
    .orderBy(asc(shippingZones.position));
}

// ---------------------------------------------------------------------------
// Métodos de envío (FASE 3)
// ---------------------------------------------------------------------------

/**
 * Cotizar el envío dejó de ser una sola pregunta.
 *
 * Hasta acá el envío era la zona de la ciudad y nada más, y el método de pago
 * era un enum del pedido sin ninguna relación con cómo se entrega. Eso hacía
 * imposible lo que hace cualquier comercio paraguayo: ofrecer al mismo tiempo
 * un courier nacional y una moto propia que cobra al entregar, y ofrecer
 * "contra entrega" **sólo** donde el comercio realmente va a estar en la
 * puerta.
 *
 * `shipping_methods` es esa tabla. Lo que sigue la traduce a opciones ya
 * cotizadas para una ciudad y un subtotal, con el precio resuelto del lado del
 * servidor y los medios de pago que cada una habilita.
 *
 * **La tabla vacía no es un caso borde: es el estado de toda tienda ya
 * clonada.** Sin filas, esto devuelve un único método implícito con el precio
 * de la zona y los tres medios de pago, o sea exactamente el checkout de
 * antes. Nadie tiene que configurar nada para seguir vendiendo igual.
 */

/** Lo que hace falta de una fila de `shipping_methods` para cotizarla. */
export type ShippingMethodRow = {
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

export type ShippingMethodOption = {
  /**
   * `null` **sólo** en el método implícito de una tienda sin métodos
   * configurados. Es lo que después queda en `orders.shipping_method_id`, y
   * que sea nullable ahí es lo que hace que un pedido viejo y uno de una
   * tienda sin configurar sean la misma fila de siempre.
   */
  id: number | null;
  slug: string;
  name: string;
  kind: ShippingMethodKind;
  description: string | null;
  /** Ya resuelto contra la zona y el subtotal. El navegador nunca lo manda. */
  shippingPyg: number;
  isFree: boolean;
  /** Nunca vacío: un método sin medios de pago no se ofrece (ver abajo). */
  allowedPaymentMethods: PaymentMethod[];
};

/** El slug del método implícito. No existe como fila: es el de siempre. */
export const IMPLICIT_SHIPPING_METHOD_SLUG = "envio-a-domicilio";

/** Los medios de pago de una fila, saneados. Vacío = la fila no se puede usar. */
function sanitizePaymentMethods(values: unknown): PaymentMethod[] {
  const list = Array.isArray(values) ? values : [];
  return PAYMENT_METHODS.filter((method) => list.includes(method));
}

/**
 * Las opciones válidas para una zona ya cotizada. **Pura**: sin DB, sin red.
 *
 * Tres reglas, y ninguna es cosmética:
 *
 * 1. **`retiro` ignora las zonas y cuesta ₲0.** No viaja a ningún lado, así
 *    que preguntarle a qué ciudad llega no tiene sentido, y cobrarle flete a
 *    quien lo va a buscar tampoco.
 * 2. **`zoneIds` vacío = todas las zonas activas.** Es el default y el caso
 *    más común (el courier nacional llega a todos lados). Con zonas
 *    declaradas, el método aplica sólo si la ciudad cayó en una de ellas
 *    **de forma exacta**: una ciudad que no está en ninguna lista se cobra
 *    con la tarifa más cara por descarte (ver `ShippingQuote.match`), y eso
 *    no la convierte en una ciudad donde la moto del comercio reparte.
 * 3. **El umbral de envío gratis de la zona se preserva con `pricing =
 *    'zona'`**, porque el precio sale tal cual de `quoteShipping`, que ya lo
 *    aplicó. Con `fijo` no hay umbral: una tarifa plana de barrio no depende
 *    del monto de la compra, y regalarla arriba de cierto subtotal es una
 *    promoción, no un precio — se configura bajando la tarifa, no acá.
 *
 * Una fila activa sin ningún medio de pago válido **se descarta**: no se
 * puede elegir sin elegir cómo pagar, y devolverla dibujaría en el checkout
 * una opción que rebota al confirmar. El ABM no deja crearla; esto cubre la
 * fila editada a mano.
 */
export function resolveShippingMethods(
  rows: readonly ShippingMethodRow[],
  zone: ShippingQuote
): ShippingMethodOption[] {
  const activas = rows
    .filter((row) => row.isActive)
    .sort((a, b) => a.position - b.position || a.id - b.id);

  if (activas.length === 0) {
    // La tienda de siempre: una sola opción implícita con el precio de la
    // zona y los tres medios de pago. No hay fila, así que no hay id.
    return [
      {
        id: null,
        slug: IMPLICIT_SHIPPING_METHOD_SLUG,
        name: t("envio.metodo.implicito"),
        kind: "courier",
        description: null,
        shippingPyg: zone.shippingPyg,
        isFree: zone.isFree,
        allowedPaymentMethods: [...PAYMENT_METHODS],
      },
    ];
  }

  const options: ShippingMethodOption[] = [];

  for (const row of activas) {
    const allowedPaymentMethods = sanitizePaymentMethods(
      row.allowedPaymentMethods
    );
    if (allowedPaymentMethods.length === 0) continue;

    if (row.kind === "retiro") {
      options.push({
        id: row.id,
        slug: row.slug,
        name: row.name,
        kind: row.kind,
        description: row.description,
        shippingPyg: 0,
        isFree: true,
        allowedPaymentMethods,
      });
      continue;
    }

    const zoneIds = Array.isArray(row.zoneIds) ? row.zoneIds : [];
    const aplica =
      zoneIds.length === 0 ||
      (zone.match === "exacta" &&
        zone.zoneId !== null &&
        zoneIds.includes(zone.zoneId));
    if (!aplica) continue;

    const shippingPyg =
      row.pricing === "fijo"
        ? Math.max(0, row.fixedPricePyg ?? 0)
        : zone.shippingPyg;

    options.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      kind: row.kind,
      description: row.description,
      shippingPyg,
      // Con `zona`, "gratis" es el umbral de la zona ya aplicado; con `fijo`,
      // es una tarifa de ₲0 puesta a mano. En pantalla dicen lo mismo.
      isFree: shippingPyg === 0,
      allowedPaymentMethods,
    });
  }

  return options;
}

export type ShippingMethodsQuote = {
  /** La zona, igual que antes: sigue siendo de dónde sale el precio base. */
  zone: ShippingQuote;
  /** Las opciones válidas para esta ciudad, en el orden del panel. */
  methods: ShippingMethodOption[];
};

/**
 * Los métodos válidos para una ciudad y un subtotal, con el precio resuelto.
 *
 * Es sólo lectura y la usan los dos caminos de siempre: la cotización pública
 * del checkout y `computeOrderTotals` adentro de la transacción que cobra. El
 * precio que se cobra sale de la segunda (ARCH.md §1 regla 1).
 */
export async function quoteShippingMethods(
  city: string,
  subtotalPyg: number,
  executor?: Executor
): Promise<ShippingMethodsQuote> {
  const tx = executor ?? getDb();
  const zone = await quoteShipping(city, subtotalPyg, tx);

  const rows = await tx
    .select()
    .from(shippingMethods)
    .where(eq(shippingMethods.isActive, true))
    .orderBy(asc(shippingMethods.position), asc(shippingMethods.id));

  return { zone, methods: resolveShippingMethods(rows.map(toMethodRow), zone) };
}

/** Una fila de la tabla, con las columnas JSON a prueba de datos viejos. */
export function toMethodRow(
  row: typeof shippingMethods.$inferSelect
): ShippingMethodRow {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    pricing: row.pricing,
    fixedPricePyg: row.fixedPricePyg,
    zoneIds: Array.isArray(row.zoneIds)
      ? row.zoneIds.map(Number).filter(Number.isInteger)
      : [],
    allowedPaymentMethods: sanitizePaymentMethods(row.allowedPaymentMethods),
    description: row.description,
    isActive: row.isActive,
    position: row.position,
  };
}

/** Por qué no se pudo usar el método que pidió el navegador. */
export type ShippingMethodRejection =
  /** No hay ningún método válido para esta ciudad. La tienda tiene un agujero. */
  | "sin_metodos"
  /** El id que mandó no está entre los válidos: inactivo, borrado u otra ciudad. */
  | "no_disponible";

export type ShippingMethodSelection =
  | { ok: true; method: ShippingMethodOption }
  | { ok: false; reason: ShippingMethodRejection };

/**
 * Cuál de las opciones se usa.
 *
 * Sin id elegido se toma **la primera por `position`**, y es a propósito que
 * no se elija "la que acepte el medio de pago que mandó": el precio del envío
 * no puede depender de cómo se paga. Un checkout viejo, o uno que no llegó a
 * elegir, obtiene siempre la misma opción y —si esa opción no acepta su medio
 * de pago— un error que lo dice, en vez de un cobro distinto en silencio.
 *
 * En la tienda sin métodos configurados esa "primera" es el método implícito,
 * que acepta los tres medios de pago: el checkout de siempre, intacto.
 */
export function selectShippingMethod(
  methods: readonly ShippingMethodOption[],
  requestedId: number | null | undefined
): ShippingMethodSelection {
  const first = methods[0];
  if (!first) return { ok: false, reason: "sin_metodos" };

  if (requestedId === null || requestedId === undefined) {
    return { ok: true, method: first };
  }

  const found = methods.find((method) => method.id === requestedId);
  return found
    ? { ok: true, method: found }
    : { ok: false, reason: "no_disponible" };
}

/**
 * Los medios de pago que esta tienda ofrece **en algún** método de envío
 * activo, en el orden del checkout. Es lo que la compradora ve anunciado
 * antes de elegir ciudad (el recuadro de confianza del checkout, la página de
 * preguntas frecuentes): la unión de lo que acepta cada método, o los tres de
 * siempre si la tienda no configuró ninguno — el mismo método implícito de
 * `resolveShippingMethods`.
 *
 * `tarjeta` sólo con Pagopar configurado, igual que en el formulario: sin
 * credenciales el checkout no la muestra, así que tampoco se promete acá.
 *
 * Es informativo: el medio que se acepta en un pedido lo sigue decidiendo
 * `createOrder` contra el método elegido.
 */
export async function offeredPaymentMethods(
  options: { cardEnabled: boolean },
  executor?: Executor
): Promise<PaymentMethod[]> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select({ allowed: shippingMethods.allowedPaymentMethods })
    .from(shippingMethods)
    .where(eq(shippingMethods.isActive, true));

  const vistos = new Set<PaymentMethod>();
  if (rows.length === 0) {
    for (const method of PAYMENT_METHODS) vistos.add(method);
  } else {
    for (const row of rows)
      for (const method of sanitizePaymentMethods(row.allowed))
        vistos.add(method);
  }

  const ready = await readyPaymentMethods(tx);
  return PAYMENT_METHODS.filter(
    (method) =>
      vistos.has(method) &&
      ready.includes(method) &&
      (method !== "tarjeta" || options.cardEnabled)
  );
}
import { readyPaymentMethods } from "./payment-readiness";
