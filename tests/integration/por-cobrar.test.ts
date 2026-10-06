import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { orders, type OrderStatus } from "@/db/schema";
import { listOrdersToRecover } from "@/domain/admin-orders";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createOrder as makeOrder } from "../helpers/factories";

/**
 * "Por cobrar" — la lista de recuperación del panel.
 *
 * Junta `pendiente_pago` y `vencido` porque para el dueño son el mismo
 * trabajo, y los ordena del más viejo al más nuevo: el más viejo es el que
 * está más cerca de perderse.
 */

/**
 * Envejece un pedido `days` días **y seis horas**.
 *
 * Las seis horas no son decoración: con un múltiplo exacto de 24 h el pedido
 * queda parado justo en el borde que `TIMESTAMPDIFF(DAY, ...)` trunca, y
 * cualquier desfasaje de milisegundos entre el reloj del proceso de tests y
 * el del servidor MySQL devuelve `days - 1`. El test se volvía cara o cruz.
 * Con margen, sigue afirmando lo mismo y ya no depende del reloj.
 */
async function ageOrder(orderId: number, days: number): Promise<void> {
  const when = new Date(Date.now() - (days * 24 + 6) * 3_600_000);
  await getTestDb().update(orders).set({ createdAt: when }).where(eq(orders.id, orderId));
}

describe.skipIf(!hasTestDb)("listOrdersToRecover", () => {
  beforeEach(async () => {
    await resetTables();
  });
  afterAll(closeTestDb);

  it("trae sólo los pedidos que se pueden recuperar", async () => {
    // `rechazado` entra: el comprobante no se pudo validar y el pedido queda
    // esperando que ella suba otro. Es un pedido sin pagar como cualquier
    // otro, y sin este estado nadie lo empujaba nunca.
    const incluidos: OrderStatus[] = ["pendiente_pago", "vencido", "rechazado"];
    const excluidos: OrderStatus[] = [
      "pagado",
      "esperando_verificacion",
      "cancelado",
      "entregado",
      "reembolsado",
    ];

    for (const status of [...incluidos, ...excluidos]) {
      await makeOrder({ status });
    }

    const { rows, total } = await listOrdersToRecover();
    expect(rows.map((row) => row.status).sort()).toEqual([...incluidos].sort());
    expect(total).toBe(incluidos.length);
  });

  it("ordena por antigüedad, el más viejo primero", async () => {
    const nuevo = await makeOrder({ status: "pendiente_pago" });
    const viejo = await makeOrder({ status: "vencido" });
    const medio = await makeOrder({ status: "pendiente_pago" });

    await ageOrder(viejo, 9);
    await ageOrder(medio, 3);

    const { rows } = await listOrdersToRecover();
    expect(rows.map((row) => row.id)).toEqual([viejo, medio, nuevo]);
    expect(rows[0]?.ageDays).toBe(9);
    expect(rows[2]?.ageDays).toBe(0);
  });

  it("trae el token: sin él la fila no puede armar el link del pedido", async () => {
    const orderId = await makeOrder({ status: "pendiente_pago" });

    const { rows } = await listOrdersToRecover();
    const row = rows[0];
    expect(row?.id).toBe(orderId);
    expect(row?.accessToken).toHaveLength(64);
  });

  it("dice cuántos hay en total cuando la lista está cortada", async () => {
    // Un listado cortado que no dice que está cortado hace que el dueño
    // termine la lista creyendo que cobró todo.
    for (let i = 0; i < 5; i += 1) await makeOrder({ status: "pendiente_pago" });

    const { rows, total } = await listOrdersToRecover(2);

    expect(rows).toHaveLength(2);
    expect(total).toBe(5);
  });

  it("la antigüedad no depende de la zona horaria del servidor MySQL", async () => {
    // `NOW()` devuelve la hora de sesión del servidor y `created_at` está en
    // UTC: con `time_zone` local (el default de Hostinger es SYSTEM) la resta
    // se iba por el offset. Un pedido de 25 horas tiene que ser 1 día en
    // cualquier servidor.
    const orderId = await makeOrder({ status: "pendiente_pago" });
    await getTestDb()
      .update(orders)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(orders.id, orderId));

    const { rows } = await listOrdersToRecover();
    expect(rows[0]?.ageDays).toBe(1);
  });

  it("es sólo lectura: no crea ni modifica reservas", async () => {
    const orderId = await makeOrder({ status: "vencido" });
    const antes = await getTestDb().select().from(orders).where(eq(orders.id, orderId));

    await listOrdersToRecover();

    const despues = await getTestDb().select().from(orders).where(eq(orders.id, orderId));
    // La reserva vence sola (ARCH.md §2): "empujar" un pedido no puede
    // bloquearle la unidad al resto de los compradores.
    expect(despues[0]?.reservedUntil).toEqual(antes[0]?.reservedUntil);
    expect(despues[0]?.status).toBe("vencido");
  });
});
