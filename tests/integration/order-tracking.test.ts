import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { orderEvents, orders } from '@/db/schema';
import { TrackingNotAllowedError, transitionOrder } from '@/domain/orders';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder, getStatus } from '../helpers/factories';

/**
 * El seguimiento del envío se escribe **con** la transición, no al lado (O5,
 * plan-operacion §5.1 B).
 *
 * Los dos modos de falla que estos tests fijan:
 *
 * 1. **Media escritura.** Si el tracking fuera un `UPDATE` aparte después de
 *    `transitionOrder`, un fallo entre los dos dejaría el pedido despachado
 *    sin guía —y la compradora recibiría el aviso de envío sin nada que
 *    rastrear— o, peor, con la guía del envío anterior.
 * 2. **Tracking donde no va.** Cargar una guía al cancelar un pedido no es
 *    una operación con sentido; aceptarla en silencio deja el dato escrito en
 *    una fila que nadie va a mirar hasta que aparezca en el lugar equivocado.
 */

const ACTOR = 'admin:test@tienda.py';

async function despachable(): Promise<number> {
  return createOrder({ status: 'preparando' });
}

async function trackingDe(orderId: number) {
  const [row] = await getTestDb()
    .select({
      carrier: orders.trackingCarrier,
      code: orders.trackingCode,
      url: orders.trackingUrl,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return row;
}

describe.skipIf(!hasTestDb)('tracking del envío', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('se escribe al pasar a enviado, en la misma transacción', async () => {
    const orderId = await despachable();

    await transitionOrder(orderId, 'enviado', ACTOR, 'salió hoy', {
      tracking: {
        carrier: 'Aereopar',
        code: 'AP-99887',
        url: 'https://aereopar.com.py/seguimiento/AP-99887',
      },
    });

    expect(await getStatus(orderId)).toBe('enviado');
    expect(await trackingDe(orderId)).toEqual({
      carrier: 'Aereopar',
      code: 'AP-99887',
      url: 'https://aereopar.com.py/seguimiento/AP-99887',
    });
  });

  it('sin tracking, el despacho es el de siempre y las columnas quedan en NULL', async () => {
    const orderId = await despachable();

    await transitionOrder(orderId, 'enviado', ACTOR);

    expect(await getStatus(orderId)).toBe('enviado');
    expect(await trackingDe(orderId)).toEqual({ carrier: null, code: null, url: null });
  });

  it('los campos vacíos entran como NULL, no como cadena vacía', async () => {
    // "Despaché en moto propia, sin guía": el formulario manda los tres
    // campos y dos vienen en blanco. Si eso quedara como `''`, cada lector
    // tendría que acordarse de tratar la cadena vacía como ausente — y el
    // aviso a la compradora diría "Guía: " con nada atrás.
    const orderId = await despachable();

    await transitionOrder(orderId, 'enviado', ACTOR, null, {
      tracking: { carrier: 'Moto propia', code: '   ', url: null },
    });

    expect(await trackingDe(orderId)).toEqual({
      carrier: 'Moto propia',
      code: null,
      url: null,
    });
  });

  it('un destino que no es enviado con tracking se rechaza', async () => {
    const orderId = await createOrder({ status: 'pagado' });

    await expect(
      transitionOrder(orderId, 'preparando', ACTOR, null, {
        tracking: { carrier: 'Aereopar', code: 'AP-1' },
      }),
    ).rejects.toBeInstanceOf(TrackingNotAllowedError);

    // Y no dejó nada a medias: ni el estado se movió ni se escribió el dato.
    expect(await getStatus(orderId)).toBe('pagado');
    expect(await trackingDe(orderId)).toEqual({ carrier: null, code: null, url: null });
  });

  it('si la transición falla después del UPDATE, el tracking se va con el rollback', async () => {
    const orderId = await despachable();

    // El fallo se provoca adentro de la transacción de quien llama, justo
    // después de que `transitionOrder` escribió el estado y el tracking: es
    // exactamente la ventana en la que un `UPDATE` aparte dejaría la guía
    // escrita en un pedido que nunca llegó a despacharse.
    await expect(
      getTestDb().transaction(async (tx) => {
        await transitionOrder(orderId, 'enviado', ACTOR, null, {
          executor: tx,
          tracking: { carrier: 'Aereopar', code: 'AP-ROLLBACK' },
        });
        throw new Error('algo explotó después de despachar');
      }),
    ).rejects.toThrow('algo explotó después de despachar');

    expect(await getStatus(orderId)).toBe('preparando');
    expect(await trackingDe(orderId)).toEqual({ carrier: null, code: null, url: null });

    // El evento de auditoría también se fue: la transición entera no pasó.
    const eventos = await getTestDb()
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId));
    expect(eventos).toHaveLength(0);
  });
});
