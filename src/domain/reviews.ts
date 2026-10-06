import { and, avg, count, desc, eq, inArray } from 'drizzle-orm';

import { getDb } from '@/db';
import {
  orderItems,
  orders,
  productReviews,
  products,
  variants,
  type ReviewStatus,
} from '@/db/schema';
import { t, type MessageKey, type Params } from '@/i18n';

import { DomainError } from './errors';
import type { Executor } from './executor';

/**
 * Reseñas de producto, **sólo de compras verificadas**.
 *
 * La regla que ordena todo este archivo, y que no se negocia por tienda:
 *
 * > **Sólo quien recibió el pedido califica.** La compradora de un pedido en
 * > estado `entregado` puede escribir una reseña de cada producto que vino en
 * > ese pedido, una sola vez. El panel **modera** (aprueba o rechaza) y
 * > **responde en público**, pero **nunca crea una reseña ni edita el texto o
 * > las estrellas de una compradora**.
 *
 * Por qué así y no más flexible: Google sólo muestra estrellas en el
 * resultado (`aggregateRating` del JSON-LD) si las reseñas son opiniones
 * genuinas de clientes, y penaliza las que escribe o maquilla el propio
 * comercio. Una función "editar reseña" en el panel es exactamente la
 * herramienta para hacer eso, así que no existe: este módulo no exporta
 * ninguna forma de cambiar `rating`, `title` ni `body` después de escritos
 * (lo verifica `tests/integration/reviews.test.ts`). Rechazar sí se puede —
 * spam, insultos, datos personales—, y lo rechazado simplemente no se
 * publica: la tienda no puede convertir un 2 en un 5, sólo decidir que un
 * texto no va.
 *
 * Tres detalles más:
 *
 * 1. **Una por producto por compra**: `UNIQUE(order_id, product_id)`. Mandar
 *    el formulario dos veces choca contra el índice y sale como "ya
 *    calificaste este producto", sin carrera posible.
 * 2. **El autor es "Nombre I."**, armado del nombre del pedido al escribir.
 *    La reseña se publica en la vidriera y en el JSON-LD: el nombre completo
 *    de la compradora no tiene por qué estar ahí.
 * 3. **Todo entra `pending`.** Lo que la vidriera y Google ven es sólo
 *    `approved`: el promedio y la cantidad se calculan sobre esas y nada más.
 */

export class ReviewError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = 'ReviewError';
  }
}

export const REVIEW_BODY_MIN = 10;
export const REVIEW_BODY_MAX = 2000;
export const REVIEW_TITLE_MAX = 120;
export const REVIEW_REPLY_MAX = 2000;

/** El estado del pedido desde el que se puede calificar. Uno solo, a propósito. */
export const REVIEWABLE_ORDER_STATUS = 'entregado' as const;

/**
 * "Rosa María Giménez" → "Rosa G.": el primer nombre y la inicial de la
 * última palabra. Alcanza para que la reseña suene a una persona y no
 * alcanza para encontrarla.
 *
 * Con una sola palabra sale sólo el nombre. Nunca vacío: sin nombre en el
 * pedido sale un genérico del catálogo, no un hueco en la vidriera.
 */
export function reviewAuthorName(customerName: string): string {
  const palabras = customerName.trim().split(/\s+/).filter(Boolean);
  const nombre = palabras[0];
  if (!nombre) return t('resena.autorSinNombre');
  const ultima = palabras.length > 1 ? palabras[palabras.length - 1] : undefined;
  const autor = ultima ? `${nombre} ${ultima.charAt(0).toLocaleUpperCase('es')}.` : nombre;
  return autor.slice(0, 80);
}

export type SubmitReviewInput = {
  orderId: number;
  productId: number;
  rating: number;
  title?: string | null;
  body: string;
};

/**
 * Escribe la reseña de una compradora. Devuelve el id de la fila.
 *
 * Quien llama ya verificó el acceso al pedido (el token del link, igual que
 * la página): esto decide si **ese** pedido puede calificar **ese**
 * producto, releyendo la base y sin confiar en nada del formulario más que
 * los ids.
 */
export async function submitReview(
  input: SubmitReviewInput,
  options: { executor?: Executor } = {},
): Promise<number> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new ReviewError('error.resena.estrellas');
  }
  const body = input.body.trim();
  if (body.length < REVIEW_BODY_MIN) {
    throw new ReviewError('error.resena.corta', { minimo: REVIEW_BODY_MIN });
  }
  if (body.length > REVIEW_BODY_MAX) {
    throw new ReviewError('error.resena.larga', { maximo: REVIEW_BODY_MAX });
  }
  const title = input.title?.trim() || null;
  if (title && title.length > REVIEW_TITLE_MAX) {
    throw new ReviewError('error.resena.tituloLargo', { maximo: REVIEW_TITLE_MAX });
  }

  const tx = options.executor ?? getDb();

  const pedido = (
    await tx
      .select({ id: orders.id, status: orders.status, customerName: orders.customerName })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1)
  )[0];
  if (!pedido) throw new ReviewError('error.resena.pedidoNoExiste');
  if (pedido.status !== REVIEWABLE_ORDER_STATUS) throw new ReviewError('error.resena.noEntregado');

  const enElPedido = await tx
    .select({ id: orderItems.id })
    .from(orderItems)
    .innerJoin(variants, eq(orderItems.variantId, variants.id))
    .where(and(eq(orderItems.orderId, pedido.id), eq(variants.productId, input.productId)))
    .limit(1);
  if (enElPedido.length === 0) throw new ReviewError('error.resena.noEstaEnElPedido');

  try {
    const [result] = await tx.insert(productReviews).values({
      orderId: pedido.id,
      productId: input.productId,
      rating: input.rating,
      title,
      body,
      authorName: reviewAuthorName(pedido.customerName),
    });
    return Number(result.insertId);
  } catch (error) {
    if (esDuplicado(error)) throw new ReviewError('error.resena.yaCalificaste');
    throw error;
  }
}

/** El INSERT chocó contra `UNIQUE(order_id, product_id)`. */
function esDuplicado(error: unknown): boolean {
  for (const candidato of [error, (error as { cause?: unknown } | null)?.cause]) {
    const code = (candidato as { code?: string } | null)?.code;
    const errno = (candidato as { errno?: number } | null)?.errno;
    if (code === 'ER_DUP_ENTRY' || errno === 1062) return true;
  }
  return false;
}

export type ReviewableItem = {
  productId: number;
  productName: string;
  /** Ya dejó su reseña de este producto en este pedido (esté como esté). */
  reviewed: boolean;
};

/**
 * Los productos de un pedido, cada uno una vez, con si ya se calificó.
 *
 * Por producto y no por línea: un pedido con la remera en S y en M es una
 * sola opinión sobre la remera.
 */
export async function listReviewableItems(
  orderId: number,
  executor?: Executor,
): Promise<ReviewableItem[]> {
  const tx = executor ?? getDb();

  const filas = await tx
    .select({ productId: products.id, productName: products.name })
    .from(orderItems)
    .innerJoin(variants, eq(orderItems.variantId, variants.id))
    .innerJoin(products, eq(variants.productId, products.id))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.id);

  const vistos = new Map<number, string>();
  for (const fila of filas) {
    if (!vistos.has(fila.productId)) vistos.set(fila.productId, fila.productName);
  }
  if (vistos.size === 0) return [];

  const hechas = await tx
    .select({ productId: productReviews.productId })
    .from(productReviews)
    .where(
      and(eq(productReviews.orderId, orderId), inArray(productReviews.productId, [...vistos.keys()])),
    );
  const calificados = new Set(hechas.map((fila) => fila.productId));

  return [...vistos.entries()].map(([productId, productName]) => ({
    productId,
    productName,
    reviewed: calificados.has(productId),
  }));
}

export type RatingSummary = {
  /** Promedio con un decimal (4.6). 0 si no hay ninguna aprobada. */
  average: number;
  count: number;
};

/** Promedio y cantidad, **sólo** sobre las aprobadas. */
export async function getProductRatingSummary(
  productId: number,
  executor?: Executor,
): Promise<RatingSummary> {
  const tx = executor ?? getDb();
  const [fila] = await tx
    .select({ n: count(), promedio: avg(productReviews.rating) })
    .from(productReviews)
    .where(and(eq(productReviews.productId, productId), eq(productReviews.status, 'approved')));

  const n = Number(fila?.n ?? 0);
  if (n === 0) return { average: 0, count: 0 };
  return { average: Math.round(Number(fila?.promedio ?? 0) * 10) / 10, count: n };
}

/**
 * Promedio y cantidad de **varios** productos en una sola consulta agrupada,
 * para las tarjetas de un listado (`hydrate` en `src/db/queries.ts`). Sólo
 * aparecen los productos con al menos una reseña aprobada: los demás no
 * tienen nada que mostrar.
 */
export async function getRatingSummaries(
  productIds: readonly number[],
  executor?: Executor,
): Promise<Map<number, RatingSummary>> {
  const resumenes = new Map<number, RatingSummary>();
  if (productIds.length === 0) return resumenes;

  const tx = executor ?? getDb();
  const filas = await tx
    .select({
      productId: productReviews.productId,
      n: count(),
      promedio: avg(productReviews.rating),
    })
    .from(productReviews)
    .where(
      and(inArray(productReviews.productId, [...productIds]), eq(productReviews.status, 'approved')),
    )
    .groupBy(productReviews.productId);

  for (const fila of filas) {
    const n = Number(fila.n ?? 0);
    if (n === 0) continue;
    resumenes.set(fila.productId, {
      average: Math.round(Number(fila.promedio ?? 0) * 10) / 10,
      count: n,
    });
  }
  return resumenes;
}

export type PublicReview = {
  id: number;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  createdAt: Date;
  ownerReply: string | null;
  ownerReplyAt: Date | null;
};

/** Las aprobadas de un producto, de la más nueva a la más vieja. */
export async function listApprovedReviews(
  productId: number,
  limit = 20,
  executor?: Executor,
): Promise<PublicReview[]> {
  const tx = executor ?? getDb();
  return tx
    .select({
      id: productReviews.id,
      rating: productReviews.rating,
      title: productReviews.title,
      body: productReviews.body,
      authorName: productReviews.authorName,
      createdAt: productReviews.createdAt,
      ownerReply: productReviews.ownerReply,
      ownerReplyAt: productReviews.ownerReplyAt,
    })
    .from(productReviews)
    .where(and(eq(productReviews.productId, productId), eq(productReviews.status, 'approved')))
    .orderBy(desc(productReviews.createdAt), desc(productReviews.id))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Panel: moderar y responder. Nada más.
// ---------------------------------------------------------------------------

/** Cuántas trae como mucho la pantalla del panel. */
export const ADMIN_REVIEWS_LIMIT = 200;

export type AdminReviewRow = PublicReview & {
  status: ReviewStatus;
  productId: number;
  productName: string;
  productSlug: string;
  orderId: number;
  orderNumber: string;
  moderatedAt: Date | null;
};

export async function listReviewsForAdmin(
  filters: { status: ReviewStatus },
  executor?: Executor,
): Promise<AdminReviewRow[]> {
  const tx = executor ?? getDb();
  return tx
    .select({
      id: productReviews.id,
      rating: productReviews.rating,
      title: productReviews.title,
      body: productReviews.body,
      authorName: productReviews.authorName,
      createdAt: productReviews.createdAt,
      ownerReply: productReviews.ownerReply,
      ownerReplyAt: productReviews.ownerReplyAt,
      status: productReviews.status,
      productId: productReviews.productId,
      productName: products.name,
      productSlug: products.slug,
      orderId: productReviews.orderId,
      orderNumber: orders.orderNumber,
      moderatedAt: productReviews.moderatedAt,
    })
    .from(productReviews)
    .innerJoin(products, eq(productReviews.productId, products.id))
    .innerJoin(orders, eq(productReviews.orderId, orders.id))
    .where(eq(productReviews.status, filters.status))
    .orderBy(desc(productReviews.createdAt), desc(productReviews.id))
    .limit(ADMIN_REVIEWS_LIMIT);
}

/** Para el link del menú: cuántas esperan que alguien las mire. */
export async function countPendingReviews(executor?: Executor): Promise<number> {
  const tx = executor ?? getDb();
  const [fila] = await tx
    .select({ n: count() })
    .from(productReviews)
    .where(eq(productReviews.status, 'pending'));
  return Number(fila?.n ?? 0);
}

export type ReviewModerator = {
  /** `users.id` de quien modera. NULL sólo fuera del panel (tests, scripts). */
  actorUserId?: number | null;
};

/**
 * Aprueba o rechaza. Se puede cambiar de opinión (una aprobada se puede
 * rechazar después y al revés): lo que no se puede es tocar lo que escribió
 * la compradora.
 */
export async function moderateReview(
  reviewId: number,
  status: Exclude<ReviewStatus, 'pending'>,
  actor: ReviewModerator,
  executor?: Executor,
): Promise<void> {
  if (status !== 'approved' && status !== 'rejected') {
    throw new ReviewError('error.resena.estadoInvalido');
  }
  const tx = executor ?? getDb();
  await existe(tx, reviewId);
  await tx
    .update(productReviews)
    .set({ status, moderatedAt: new Date(), moderatedByUserId: actor.actorUserId ?? null })
    .where(eq(productReviews.id, reviewId));
}

/**
 * La respuesta pública de la tienda. Texto vacío o `null` la borra.
 *
 * Es lo único que el panel escribe en la reseña, y va en su propia columna:
 * en la vidriera sale debajo, con "Respuesta de la tienda", nunca mezclada
 * con lo que dijo la compradora.
 */
export async function replyToReview(
  reviewId: number,
  text: string | null,
  // Se recibe por simetría con `moderateReview` y para que la acción tenga
  // que decir quién responde; la tabla no guarda un segundo "quién" — la
  // respuesta es de la tienda, no de una persona.
  _actor: ReviewModerator,
  executor?: Executor,
): Promise<void> {
  const reply = text?.trim() || null;
  if (reply && reply.length > REVIEW_REPLY_MAX) {
    throw new ReviewError('error.resena.respuestaLarga', { maximo: REVIEW_REPLY_MAX });
  }
  const tx = executor ?? getDb();
  await existe(tx, reviewId);
  await tx
    .update(productReviews)
    .set({
      ownerReply: reply,
      ownerReplyAt: reply ? new Date() : null,
    })
    .where(eq(productReviews.id, reviewId));
}

async function existe(tx: Executor, reviewId: number): Promise<void> {
  const filas = await tx
    .select({ id: productReviews.id })
    .from(productReviews)
    .where(eq(productReviews.id, reviewId))
    .limit(1);
  if (filas.length === 0) throw new ReviewError('error.resena.noExiste');
}
