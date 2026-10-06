import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { stockAlerts, variants } from '@/db/schema';
import { adjustStock } from '@/domain/admin-products';
import type { MessageSender } from '@/domain/messaging';
import {
  notifyBackInStock,
  purgeNotifiedStockAlerts,
  StockAlertError,
  stockAlertsEnabled,
  subscribeStockAlert,
  sweepBackInStock,
} from '@/domain/stock-alerts';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createAdminUser, createVariant } from '../helpers/factories';

/**
 * "Avisame cuando haya stock" (O6, plan-operacion §5.2 E).
 *
 * Lo que fijan estos tests es que esto no se convierta en una máquina de spam:
 * una fila por teléfono y variante, marcada **antes** de mandar, y un aviso por
 * reposición y no uno por ajuste.
 */

function senderQueGuarda(): { sender: MessageSender; enviados: string[] } {
  const enviados: string[] = [];
  return {
    enviados,
    sender: {
      channel: 'consola',
      label: 'test',
      async send(message) {
        enviados.push(message.to);
      },
    },
  };
}

/** Enciende la feature: la plantilla es el interruptor, en cualquier canal. */
function conPlantilla(): void {
  vi.stubEnv('WHATSAPP_CLOUD_TEMPLATE_STOCK_DISPONIBLE', 'stock_disponible');
}

const TELEFONO = '+595981123456';
const OTRO_TELEFONO = '+595981999888';

describe.skipIf(!hasTestDb)('subscribeStockAlert', () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await resetTables();
  });
  afterAll(closeTestDb);

  it('sin plantilla, la feature entera está apagada', async () => {
    const variantId = await createVariant({ onHand: 0 });

    expect(stockAlertsEnabled()).toBe(false);
    await expect(
      subscribeStockAlert({ variantId, phone: TELEFONO }),
    ).rejects.toBeInstanceOf(StockAlertError);
  });

  it('anota el teléfono de una variante agotada', async () => {
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });

    await subscribeStockAlert({ variantId, phone: TELEFONO });

    const filas = await getTestDb().select().from(stockAlerts);
    expect(filas).toHaveLength(1);
    expect(filas[0]?.phone).toBe(TELEFONO);
    expect(filas[0]?.notifiedAt).toBeNull();
  });

  it('normaliza el teléfono antes de guardarlo', async () => {
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });

    // El mismo aparato escrito de dos formas tiene que ser una sola fila; si
    // no, el UNIQUE no unifica nada y la persona recibe dos avisos.
    await subscribeStockAlert({ variantId, phone: '0981 123 456' });
    await subscribeStockAlert({ variantId, phone: '+595981123456' });

    const filas = await getTestDb().select().from(stockAlerts);
    expect(filas).toHaveLength(1);
    expect(filas[0]?.phone).toBe(TELEFONO);
  });

  it('anotarse dos veces no es un error ni crea dos filas', async () => {
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });

    await subscribeStockAlert({ variantId, phone: TELEFONO });
    await expect(subscribeStockAlert({ variantId, phone: TELEFONO })).resolves.toBeUndefined();

    expect(await getTestDb().select().from(stockAlerts)).toHaveLength(1);
  });

  it('se rechaza si hay stock: anotarse para algo comprable es un malentendido', async () => {
    conPlantilla();
    const variantId = await createVariant({ onHand: 4 });

    await expect(
      subscribeStockAlert({ variantId, phone: TELEFONO }),
    ).rejects.toBeInstanceOf(StockAlertError);
    expect(await getTestDb().select().from(stockAlerts)).toHaveLength(0);
  });

  it('se rechaza para una variante despublicada', async () => {
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });
    await getTestDb().update(variants).set({ isActive: false }).where(eq(variants.id, variantId));

    await expect(
      subscribeStockAlert({ variantId, phone: TELEFONO }),
    ).rejects.toBeInstanceOf(StockAlertError);
  });

  it('se rechaza un teléfono que no es paraguayo', async () => {
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });

    await expect(
      subscribeStockAlert({ variantId, phone: '+54 11 1234 5678' }),
    ).rejects.toBeInstanceOf(StockAlertError);
  });
});

describe.skipIf(!hasTestDb)('notifyBackInStock', () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await resetTables();
  });
  afterAll(closeTestDb);

  it('avisa a los pendientes y los marca', async () => {
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });
    await subscribeStockAlert({ variantId, phone: TELEFONO });
    await subscribeStockAlert({ variantId, phone: OTRO_TELEFONO });
    await getTestDb().update(variants).set({ onHand: 5 }).where(eq(variants.id, variantId));

    const { sender, enviados } = senderQueGuarda();
    const resultado = await notifyBackInStock(variantId, { notifier: { sender } });

    expect(resultado).toEqual({ marcadas: 2, enviadas: 2 });
    expect(enviados.sort()).toEqual([OTRO_TELEFONO, TELEFONO].sort());

    const filas = await getTestDb().select().from(stockAlerts);
    expect(filas.every((fila) => fila.notifiedAt !== null)).toBe(true);
  });

  it('correrlo dos veces no manda dos veces', async () => {
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });
    await subscribeStockAlert({ variantId, phone: TELEFONO });
    await getTestDb().update(variants).set({ onHand: 5 }).where(eq(variants.id, variantId));

    const { sender, enviados } = senderQueGuarda();
    await notifyBackInStock(variantId, { notifier: { sender } });
    await notifyBackInStock(variantId, { notifier: { sender } });

    expect(enviados).toHaveLength(1);
  });

  it('si el stock se fue entre el commit y el aviso, no avisa', async () => {
    // Entre el ajuste que subió el stock y esta línea, otra compradora pudo
    // llevarse la última unidad. Avisar de un stock que ya no está es peor que
    // no avisar: manda a alguien a una página con el botón deshabilitado.
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });
    await subscribeStockAlert({ variantId, phone: TELEFONO });

    const { sender, enviados } = senderQueGuarda();
    const resultado = await notifyBackInStock(variantId, { notifier: { sender } });

    expect(resultado).toEqual({ marcadas: 0, enviadas: 0 });
    expect(enviados).toHaveLength(0);
  });

  it('el aviso que falla deja la fila marcada igual: no se reintenta', async () => {
    // Marcar después de mandar sería la alternativa, y es peor: un error a
    // mitad de la tanda vuelve a mandarle a los primeros en cada reintento.
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });
    await subscribeStockAlert({ variantId, phone: TELEFONO });
    await getTestDb().update(variants).set({ onHand: 5 }).where(eq(variants.id, variantId));

    const roto: MessageSender = {
      channel: 'consola',
      label: 'roto',
      async send() {
        throw new Error('Meta dijo que no');
      },
    };

    const resultado = await notifyBackInStock(variantId, { notifier: { sender: roto } });
    expect(resultado).toEqual({ marcadas: 1, enviadas: 0 });

    const [fila] = await getTestDb().select().from(stockAlerts);
    expect(fila?.notifiedAt).not.toBeNull();
  });

  it('no tira nunca: corre detrás de un ajuste ya commiteado', async () => {
    conPlantilla();
    await expect(notifyBackInStock(999_999, { notifier: null })).resolves.toEqual({
      marcadas: 0,
      enviadas: 0,
    });
  });
});

describe.skipIf(!hasTestDb)('disparo desde adjustStock', () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await resetTables();
  });
  afterAll(closeTestDb);

  it('un ajuste de 0 a 5 avisa una sola vez, aunque se ajuste de nuevo', async () => {
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });
    const userId = await createAdminUser({ email: 'due@tienda.py' });
    await subscribeStockAlert({ variantId, phone: TELEFONO });

    await adjustStock({
      variantId,
      delta: 5,
      reason: 'repuse cinco',
      actor: 'admin:due@tienda.py',
      actorUserId: userId,
    });
    // El disparo va sin `await` detrás del commit: se le da lugar al event loop.
    await esperarAvisos();

    const despuesDelPrimero = await getTestDb().select().from(stockAlerts);
    expect(despuesDelPrimero[0]?.notifiedAt).not.toBeNull();

    await adjustStock({
      variantId,
      delta: 3,
      reason: 'repuse tres mas',
      actor: 'admin:due@tienda.py',
      actorUserId: userId,
    });
    await esperarAvisos();

    // Sigue habiendo una sola fila y sigue marcada una sola vez: el segundo
    // ajuste no cruzó de 0 a algo, así que no dispara nada.
    expect(await getTestDb().select().from(stockAlerts)).toHaveLength(1);
  });

  it('un ajuste que baja el stock no dispara nada', async () => {
    conPlantilla();
    const variantId = await createVariant({ onHand: 10 });
    const userId = await createAdminUser({ email: 'due@tienda.py' });
    // Se anota a mano (el alta pública rechazaría: hay stock).
    await getTestDb()
      .execute(sql`INSERT INTO \`stock_alerts\` (\`variant_id\`, \`phone\`) VALUES (${variantId}, ${TELEFONO})`);

    await adjustStock({
      variantId,
      delta: -2,
      reason: 'rotura',
      actor: 'admin:due@tienda.py',
      actorUserId: userId,
    });
    await esperarAvisos();

    const [fila] = await getTestDb().select().from(stockAlerts);
    expect(fila?.notifiedAt).toBeNull();
  });
});

describe.skipIf(!hasTestDb)('barrido y purga', () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await resetTables();
  });
  afterAll(closeTestDb);

  it('el barrido cubre la disponibilidad que liberó una reserva vencida', async () => {
    // El caso que el disparo post-ajuste no puede cubrir: nadie escribió nada,
    // la reserva simplemente venció. Sin barrido, esas suscripciones esperan
    // hasta el próximo ajuste manual.
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });
    await subscribeStockAlert({ variantId, phone: TELEFONO });
    await getTestDb().update(variants).set({ onHand: 3 }).where(eq(variants.id, variantId));

    const { sender, enviados } = senderQueGuarda();
    const resultado = await sweepBackInStock({ notifier: { sender } });

    expect(resultado).toEqual({ variantes: 1, enviadas: 1 });
    expect(enviados).toEqual([TELEFONO]);
  });

  it('el barrido ignora las variantes que siguen agotadas', async () => {
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });
    await subscribeStockAlert({ variantId, phone: TELEFONO });

    const { sender } = senderQueGuarda();
    expect(await sweepBackInStock({ notifier: { sender } })).toEqual({ variantes: 0, enviadas: 0 });
  });

  it('la purga borra las avisadas viejas y deja las pendientes', async () => {
    conPlantilla();
    const variantId = await createVariant({ onHand: 0 });
    await subscribeStockAlert({ variantId, phone: TELEFONO });
    await subscribeStockAlert({ variantId, phone: OTRO_TELEFONO });

    const hace100Dias = new Date(Date.now() - 100 * 24 * 3600_000);
    await getTestDb()
      .update(stockAlerts)
      .set({ notifiedAt: hace100Dias })
      .where(eq(stockAlerts.phone, TELEFONO));

    const borradas = await purgeNotifiedStockAlerts();
    expect(borradas).toBe(1);

    const quedan = await getTestDb().select().from(stockAlerts);
    // La que no se avisó sigue viva: es una promesa pendiente, por vieja que sea.
    expect(quedan.map((fila) => fila.phone)).toEqual([OTRO_TELEFONO]);
  });
});

/**
 * Los avisos salen con `void … .catch()` después del commit: no hay nada a
 * qué hacerle `await`. Se le da lugar al event loop unos ticks, que es lo
 * único honesto que se puede hacer sin exponer una promesa que en producción
 * nadie espera.
 */
async function esperarAvisos(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
}
