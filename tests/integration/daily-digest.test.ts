import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { orders, variants } from "@/db/schema";
import {
  buildDailyDigest,
  digestBody,
  sendDailyDigest,
} from "@/domain/daily-digest";
import type { MessageSender } from "@/domain/messaging";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import {
  createOrder,
  createProduct,
  createVariant,
} from "../helpers/factories";

/**
 * El resumen diario al dueño (O6, plan-operacion §5.2 C).
 *
 * Dos cosas se fijan acá y las dos son de contenido, no de plomería: que las
 * cuatro secciones cuenten lo que tienen que contar, y que **no viaje ni un
 * dato de compradora** — esto sale por Meta y queda en el historial de un
 * WhatsApp que se comparte más de lo que uno quisiera.
 */

/** 13:00 en Asunción del 12/08. Los "ayer" se cuentan contra este instante. */
const HOY = new Date("2026-08-12T16:00:00Z");
const AYER = new Date("2026-08-11T18:00:00Z"); // 15:00 PY del 11
const ANTEAYER = new Date("2026-08-10T18:00:00Z");

async function fechar(orderId: number, createdAt: Date): Promise<void> {
  // SQL crudo: `orders.created_at` no es `ON UPDATE`, pero el `updated_at` sí,
  // y acá sólo interesa mover la fecha de creación.
  await getTestDb().execute(
    sql`UPDATE \`orders\` SET \`created_at\` = ${createdAt} WHERE \`id\` = ${orderId}`
  );
}

function senderQueGuarda(): { sender: MessageSender; enviados: string[] } {
  const enviados: string[] = [];
  return {
    enviados,
    sender: {
      channel: "consola",
      label: "test",
      async send(message) {
        enviados.push(message.body);
      },
    },
  };
}

describe.skipIf(!hasTestDb)("buildDailyDigest", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("sin nada, dice que no hay novedades", async () => {
    const digest = await buildDailyDigest(HOY);

    expect(digest.sinNovedades).toBe(true);
    expect(digest.comprobantesPendientes).toBe(0);
    expect(digest.sinPagar).toEqual([]);
    expect(digest.stockBajo).toEqual([]);
    expect(digest.ayer).toEqual({ totalPyg: 0, orders: 0 });
  });

  it("cuenta los comprobantes esperando revisión", async () => {
    await createOrder({ status: "esperando_verificacion" });
    await createOrder({ status: "esperando_verificacion" });
    await createOrder({ status: "pagado" });

    const digest = await buildDailyDigest(HOY);
    expect(digest.comprobantesPendientes).toBe(2);
  });

  it("lista los pedidos sin pagar de más de un día, del más viejo primero", async () => {
    const viejo = await createOrder({ status: "pendiente_pago" });
    const masViejo = await createOrder({ status: "esperando_verificacion" });
    const reciente = await createOrder({ status: "pendiente_pago" });

    await fechar(viejo, new Date(HOY.getTime() - 30 * 3600_000));
    await fechar(masViejo, new Date(HOY.getTime() - 72 * 3600_000));
    // Éste no entra: tiene 3 horas, y el dueño no puede hacer nada todavía.
    await fechar(reciente, new Date(HOY.getTime() - 3 * 3600_000));

    const digest = await buildDailyDigest(HOY);
    expect(digest.sinPagar).toHaveLength(2);
    expect(digest.sinPagar[0]?.horas).toBe(72);
    expect(digest.sinPagar[1]?.horas).toBe(30);
  });

  it("un pedido ya cobrado no aparece como sin pagar, por viejo que sea", async () => {
    const pagado = await createOrder({ status: "pagado" });
    await fechar(pagado, new Date(HOY.getTime() - 200 * 3600_000));

    expect((await buildDailyDigest(HOY)).sinPagar).toEqual([]);
  });

  it("suma las ventas del día calendario de ayer, no de las últimas 24 h", async () => {
    const deAyer = await createOrder({ status: "pagado", totalPyg: 150_000 });
    const tambienDeAyer = await createOrder({
      status: "entregado",
      totalPyg: 50_000,
    });
    const deAnteayer = await createOrder({
      status: "pagado",
      totalPyg: 999_000,
    });
    const deHoy = await createOrder({ status: "pagado", totalPyg: 999_000 });

    await fechar(deAyer, AYER);
    await fechar(tambienDeAyer, AYER);
    await fechar(deAnteayer, ANTEAYER);
    await fechar(deHoy, HOY);

    const digest = await buildDailyDigest(HOY);
    expect(digest.ayer).toEqual({ totalPyg: 200_000, orders: 2 });
  });

  it("un pedido cancelado de ayer no cuenta como venta", async () => {
    const cancelado = await createOrder({
      status: "cancelado",
      totalPyg: 500_000,
    });
    await fechar(cancelado, AYER);

    expect((await buildDailyDigest(HOY)).ayer).toEqual({
      totalPyg: 0,
      orders: 0,
    });
  });

  it("el stock bajo usa el punto de reposición de cada variante", async () => {
    // Dos variantes con el mismo stock y umbrales distintos: sólo una está en
    // problemas. Con un único umbral global las dos entrarían o ninguna, que
    // es exactamente el motivo por el que la columna existe.
    const urgente = await createVariant({ onHand: 5 });
    const tranquila = await createVariant({ onHand: 5 });
    const db = getTestDb();
    await db
      .update(variants)
      .set({ reorderPoint: 10 })
      .where(eq(variants.id, urgente));
    await db
      .update(variants)
      .set({ reorderPoint: 1 })
      .where(eq(variants.id, tranquila));

    const digest = await buildDailyDigest(HOY);
    expect(digest.stockBajo.map((v) => v.variantId)).toEqual([urgente]);
    expect(digest.stockBajo[0]?.reorderPoint).toBe(10);
  });

  it("ordena por urgencia contra el umbral propio, no por stock crudo", async () => {
    // Este test existe por un bug real: `on_hand` y `reorder_point` son
    // INT UNSIGNED y la resta del ORDER BY se hacía sin signo. MySQL 8 tira
    // ER_DATA_OUT_OF_RANGE en cuanto `on_hand < reorder_point` —o sea, en
    // todas las filas que esta consulta busca— y MariaDB devolvía la vuelta al
    // revés en silencio, con el orden dado vuelta y nadie enterándose.
    const productId = await createProduct();
    const desesperada = await createVariant({ onHand: 1, productId }); // 1 de 20
    const incomoda = await createVariant({ onHand: 8, productId }); // 8 de 10
    const db = getTestDb();
    await db
      .update(variants)
      .set({ reorderPoint: 20 })
      .where(eq(variants.id, desesperada));
    await db
      .update(variants)
      .set({ reorderPoint: 10 })
      .where(eq(variants.id, incomoda));

    const digest = await buildDailyDigest(HOY);
    // La de 1 unidad va primero aunque las dos estén bajo su umbral: le faltan
    // 19 y a la otra 2. Por stock crudo el orden sería el mismo acá, así que
    // lo que fija el test es que la consulta **no explote** y que el criterio
    // sea la distancia al umbral.
    expect(digest.stockBajo.map((v) => v.variantId)).toEqual([
      desesperada,
      incomoda,
    ]);
  });

  it("sin punto de reposición propio, usa el umbral global", async () => {
    const baja = await createVariant({ onHand: 2 });
    await createVariant({ onHand: 50 });

    const digest = await buildDailyDigest(HOY);
    expect(digest.stockBajo.map((v) => v.variantId)).toEqual([baja]);
    expect(digest.stockBajo[0]?.reorderPoint).toBe(3);
  });

  it('un día sin ventas pero con comprobantes NO es "sin novedades"', async () => {
    await createOrder({ status: "esperando_verificacion" });
    expect((await buildDailyDigest(HOY)).sinNovedades).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("digestBody", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("las secciones vacías no salen", async () => {
    await createOrder({ status: "esperando_verificacion" });

    const body = digestBody(await buildDailyDigest(HOY));
    expect(body).toContain("Comprobantes por revisar: 1");
    // Nada de "Stock bajo: 0" ni "Pedidos sin pagar: 0": un mensaje con tres
    // ceros se deja de leer a la semana.
    expect(body).not.toContain("Stock bajo");
    expect(body).not.toContain("sin pagar");
  });

  it("no lleva ningún dato de la compradora", async () => {
    const viejo = await createOrder({ status: "pendiente_pago" });
    await fechar(viejo, new Date(HOY.getTime() - 48 * 3600_000));
    const [pedido] = await getTestDb()
      .select({ orderNumber: orders.orderNumber })
      .from(orders)
      .where(eq(orders.id, viejo));

    const body = digestBody(await buildDailyDigest(HOY));

    // El número de pedido sí (es lo que el dueño va a buscar en el panel);
    // el teléfono, el nombre y la dirección no.
    expect(body).toContain(pedido?.orderNumber);
    expect(body).not.toMatch(/\+595/);
    expect(body).not.toContain("Cliente de Prueba");
    expect(body).not.toContain("Av. Mcal. López");
  });

  it("formatea la plata en guaraníes enteros", async () => {
    const venta = await createOrder({ status: "pagado", totalPyg: 1_250_000 });
    await fechar(venta, AYER);

    expect(digestBody(await buildDailyDigest(HOY))).toContain("₲ 1.250.000");
  });

  it("sin novedades igual dice algo: el dueño tiene que saber que el cron vive", async () => {
    const body = digestBody(await buildDailyDigest(HOY));
    expect(body).toContain("Sin novedades");
  });
});

describe.skipIf(!hasTestDb)("sendDailyDigest", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("sin plantilla configurada no manda nada", async () => {
    const resultado = await sendDailyDigest({ now: HOY, notifier: null });
    expect(resultado.sent).toBe(false);
    expect(resultado.error).toBe("apagado");
  });

  it("con notifier, manda el texto del resumen", async () => {
    const { sender, enviados } = senderQueGuarda();

    const resultado = await sendDailyDigest({
      now: HOY,
      notifier: { sender, to: "+595981123456" },
    });

    expect(resultado.sent).toBe(true);
    expect(resultado.error).toBeNull();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toContain("Resumen de hoy");
  });

  it("un sender que tira no hace fallar la corrida", async () => {
    // Ésta es la regla que hace que la ruta pueda contestar 200: si esto
    // tirara, Hostinger vería un 500 y reintentaría — y el reintento tampoco
    // mandaría nada, porque `job_runs` ya está marcado.
    const roto: MessageSender = {
      channel: "consola",
      label: "roto",
      async send() {
        throw new Error("Meta dijo que no");
      },
    };

    const resultado = await sendDailyDigest({
      now: HOY,
      notifier: { sender: roto, to: "+595981123456" },
    });

    expect(resultado.sent).toBe(false);
    expect(resultado.error).toBe("Error");
    expect(resultado.error).not.toContain("Meta dijo que no");
    // Y el resumen igual se armó: lo que falló fue el envío, no el cálculo.
    expect(resultado.digest.sinNovedades).toBe(true);
  });
});
