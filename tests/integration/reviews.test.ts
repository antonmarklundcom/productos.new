import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { orderItems, orders, productReviews } from '@/db/schema';
import * as reviewsModule from '@/domain/reviews';
import {
  ReviewError,
  getProductRatingSummary,
  getRatingSummaries,
  listApprovedReviews,
  listReviewableItems,
  listReviewsForAdmin,
  moderateReview,
  replyToReview,
  reviewAuthorName,
  submitReview,
} from '@/domain/reviews';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createAdminUser, createOrder, createProduct, createVariant } from '../helpers/factories';

/**
 * Reseñas verificadas (`src/domain/reviews.ts`).
 *
 * Lo que fijan estos tests es la regla de Google: sólo quien recibió el
 * pedido califica, una vez por producto, y el panel modera y responde pero no
 * tiene ninguna forma de escribir o reescribir una reseña.
 */

async function lineaDePedido(orderId: number, variantId: number, qty = 1): Promise<void> {
  await getTestDb().insert(orderItems).values({
    orderId,
    variantId,
    nameSnapshot: 'Remera',
    skuSnapshot: `SKU-${variantId}`,
    unitPricePyg: 100_000,
    qty,
    ivaRate: 10,
    lineTotalPyg: 100_000 * qty,
  });
}

/** Un pedido entregado de "Rosa María Giménez" con un producto adentro. */
async function pedidoEntregado(): Promise<{ orderId: number; productId: number; variantId: number }> {
  const productId = await createProduct();
  const variantId = await createVariant({ onHand: 5, productId });
  const orderId = await createOrder({ status: 'entregado' });
  await getTestDb()
    .update(orders)
    .set({ customerName: 'Rosa María Giménez' })
    .where(eq(orders.id, orderId));
  await lineaDePedido(orderId, variantId);
  return { orderId, productId, variantId };
}

const TEXTO = 'Muy linda, la tela es suave y llegó rápido.';

describe.skipIf(!hasTestDb)('reseñas verificadas', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('el autor es "Nombre I.", nunca el nombre completo', () => {
    expect(reviewAuthorName('Rosa María Giménez')).toBe('Rosa G.');
    expect(reviewAuthorName('  rosa   giménez ')).toBe('rosa G.');
    expect(reviewAuthorName('Rosa')).toBe('Rosa');
  });

  it('una compradora con el pedido entregado califica, y entra pendiente con su autor abreviado', async () => {
    const { orderId, productId } = await pedidoEntregado();

    const id = await submitReview({ orderId, productId, rating: 5, title: ' Hermosa ', body: `  ${TEXTO}  ` });

    const [fila] = await getTestDb().select().from(productReviews).where(eq(productReviews.id, id));
    expect(fila).toMatchObject({
      orderId,
      productId,
      rating: 5,
      title: 'Hermosa',
      body: TEXTO,
      authorName: 'Rosa G.',
      status: 'pending',
      ownerReply: null,
    });
  });

  it.each(['pendiente_pago', 'pagado', 'preparando', 'enviado', 'cancelado', 'reembolsado'] as const)(
    'con el pedido en %s no se puede calificar',
    async (status) => {
      const productId = await createProduct();
      const variantId = await createVariant({ onHand: 5, productId });
      const orderId = await createOrder({ status });
      await lineaDePedido(orderId, variantId);

      await expect(submitReview({ orderId, productId, rating: 5, body: TEXTO })).rejects.toMatchObject({
        code: 'error.resena.noEntregado',
      });
    },
  );

  it('el producto tiene que estar en el pedido', async () => {
    const { orderId } = await pedidoEntregado();
    const otroProducto = await createProduct();

    await expect(
      submitReview({ orderId, productId: otroProducto, rating: 4, body: TEXTO }),
    ).rejects.toMatchObject({ code: 'error.resena.noEstaEnElPedido' });
  });

  it('una sola por producto por pedido: la segunda sale como "ya calificaste"', async () => {
    const { orderId, productId } = await pedidoEntregado();

    await submitReview({ orderId, productId, rating: 5, body: TEXTO });
    const segunda = submitReview({ orderId, productId, rating: 1, body: 'Cambié de opinión, no me gustó.' });

    await expect(segunda).rejects.toBeInstanceOf(ReviewError);
    await expect(segunda).rejects.toMatchObject({ code: 'error.resena.yaCalificaste' });
    expect(await getTestDb().select().from(productReviews)).toHaveLength(1);
  });

  it('valida estrellas y largo del texto', async () => {
    const { orderId, productId } = await pedidoEntregado();

    await expect(submitReview({ orderId, productId, rating: 0, body: TEXTO })).rejects.toMatchObject({
      code: 'error.resena.estrellas',
    });
    await expect(submitReview({ orderId, productId, rating: 6, body: TEXTO })).rejects.toMatchObject({
      code: 'error.resena.estrellas',
    });
    await expect(submitReview({ orderId, productId, rating: 4.5, body: TEXTO })).rejects.toMatchObject({
      code: 'error.resena.estrellas',
    });
    await expect(
      submitReview({ orderId, productId, rating: 4, body: '   corta     ' }),
    ).rejects.toMatchObject({ code: 'error.resena.corta' });
    await expect(
      submitReview({ orderId, productId, rating: 4, body: 'x'.repeat(2001) }),
    ).rejects.toMatchObject({ code: 'error.resena.larga' });
  });

  it('listReviewableItems: cada producto una vez, con si ya se calificó', async () => {
    const { orderId, productId } = await pedidoEntregado();
    // Otra variante del mismo producto: sigue siendo una sola opinión.
    await lineaDePedido(orderId, await createVariant({ onHand: 1, productId }));
    const otro = await createProduct();
    await lineaDePedido(orderId, await createVariant({ onHand: 1, productId: otro }));

    await submitReview({ orderId, productId, rating: 5, body: TEXTO });

    const items = await listReviewableItems(orderId);
    expect(items.map((item) => [item.productId, item.reviewed])).toEqual([
      [productId, true],
      [otro, false],
    ]);
  });

  it('el resumen y la lista pública cuentan sólo las aprobadas', async () => {
    const adminId = await createAdminUser();
    const productId = await createProduct();
    const variantId = await createVariant({ onHand: 9, productId });

    const ids: number[] = [];
    for (const rating of [5, 4, 4, 1]) {
      const orderId = await createOrder({ status: 'entregado' });
      await lineaDePedido(orderId, variantId);
      ids.push(await submitReview({ orderId, productId, rating, body: TEXTO }));
    }

    expect(await getProductRatingSummary(productId)).toEqual({ average: 0, count: 0 });
    expect(await listApprovedReviews(productId)).toEqual([]);

    await moderateReview(ids[0]!, 'approved', { actorUserId: adminId });
    await moderateReview(ids[1]!, 'approved', { actorUserId: adminId });
    await moderateReview(ids[2]!, 'approved', { actorUserId: adminId });
    await moderateReview(ids[3]!, 'rejected', { actorUserId: adminId });

    // (5 + 4 + 4) / 3 = 4,333… → 4,3. El 1 rechazado no cuenta.
    expect(await getProductRatingSummary(productId)).toEqual({ average: 4.3, count: 3 });
    expect((await listApprovedReviews(productId)).map((review) => review.id).sort()).toEqual(
      [ids[0], ids[1], ids[2]].sort(),
    );
    expect((await listReviewsForAdmin({ status: 'rejected' })).map((review) => review.id)).toEqual([ids[3]]);
    expect(await listReviewsForAdmin({ status: 'pending' })).toEqual([]);
  });

  it('getRatingSummaries: una consulta para varios productos, sólo aprobadas', async () => {
    const adminId = await createAdminUser();
    const conResenas = await createProduct();
    const soloPendiente = await createProduct();
    const sinNada = await createProduct();

    for (const [productId, rating, aprobar] of [
      [conResenas, 5, true],
      [conResenas, 4, true],
      [conResenas, 1, false],
      [soloPendiente, 5, false],
    ] as const) {
      const variantId = await createVariant({ onHand: 3, productId });
      const orderId = await createOrder({ status: 'entregado' });
      await lineaDePedido(orderId, variantId);
      const id = await submitReview({ orderId, productId, rating, body: TEXTO });
      if (aprobar) await moderateReview(id, 'approved', { actorUserId: adminId });
    }

    const resumenes = await getRatingSummaries([conResenas, soloPendiente, sinNada]);
    expect(resumenes.get(conResenas)).toEqual({ average: 4.5, count: 2 });
    expect(resumenes.has(soloPendiente)).toBe(false);
    expect(resumenes.has(sinNada)).toBe(false);
    expect((await getRatingSummaries([])).size).toBe(0);
  });

  it('moderar deja quién y cuándo; responder guarda y vacío borra', async () => {
    const adminId = await createAdminUser();
    const { orderId, productId } = await pedidoEntregado();
    const id = await submitReview({ orderId, productId, rating: 2, body: TEXTO });

    await moderateReview(id, 'approved', { actorUserId: adminId });
    await replyToReview(id, '  ¡Gracias, Rosa! Te escribimos por el cambio.  ', { actorUserId: adminId });

    let [fila] = await getTestDb().select().from(productReviews).where(eq(productReviews.id, id));
    expect(fila?.status).toBe('approved');
    expect(fila?.moderatedByUserId).toBe(adminId);
    expect(fila?.moderatedAt).toBeInstanceOf(Date);
    expect(fila?.ownerReply).toBe('¡Gracias, Rosa! Te escribimos por el cambio.');
    expect(fila?.ownerReplyAt).toBeInstanceOf(Date);
    // Lo de la compradora, intacto.
    expect(fila).toMatchObject({ rating: 2, body: TEXTO, title: null });

    const [publica] = await listApprovedReviews(productId);
    expect(publica?.ownerReply).toBe('¡Gracias, Rosa! Te escribimos por el cambio.');

    await replyToReview(id, '   ', { actorUserId: adminId });
    [fila] = await getTestDb().select().from(productReviews).where(eq(productReviews.id, id));
    expect(fila?.ownerReply).toBeNull();
    expect(fila?.ownerReplyAt).toBeNull();
  });

  it('moderar o responder una reseña que no existe es un error legible', async () => {
    await expect(moderateReview(999_999, 'approved', {})).rejects.toMatchObject({
      code: 'error.resena.noExiste',
    });
    await expect(replyToReview(999_999, 'hola', {})).rejects.toMatchObject({
      code: 'error.resena.noExiste',
    });
  });

  it('el panel no tiene cómo crear ni editar una reseña: la API exportada es ésta y nada más', () => {
    const funciones = Object.entries(reviewsModule)
      .filter(([, valor]) => typeof valor === 'function' && !/^[A-Z]/.test(valorNombre(valor)))
      .map(([nombre]) => nombre)
      .sort();

    // La única escritura de contenido es `submitReview`, y exige un pedido
    // entregado. Si alguien agrega un `updateReview`/`adminCreateReview`, este
    // test tiene que fallar y la regla del encabezado de reviews.ts volver a
    // discutirse.
    expect(funciones).toEqual(
      [
        'countPendingReviews',
        'getProductRatingSummary',
        // Lectura: el mismo resumen, agrupado para las tarjetas de un listado.
        'getRatingSummaries',
        'listApprovedReviews',
        'listReviewableItems',
        'listReviewsForAdmin',
        'moderateReview',
        'replyToReview',
        'reviewAuthorName',
        'submitReview',
      ].sort(),
    );
  });
});

function valorNombre(valor: unknown): string {
  return (valor as { name?: string }).name ?? '';
}
