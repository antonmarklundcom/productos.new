import { seedPaymentReadiness } from "../helpers/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  coupons,
  orderEvents,
  orderItems,
  orders,
  payments,
  shippingZones,
  stockReservations,
} from "@/db/schema";
import { createCoupon } from "@/domain/admin-coupons";
import { getAdminOrder } from "@/domain/admin-orders";
import {
  createOrder as placeOrder,
  type CreateOrderInput,
} from "@/domain/create-order";
import {
  EDIT_ORDER_REASON_PREFIX,
  EditOrderError,
  canEditPendingOrder,
  editPendingOrder,
} from "@/domain/edit-order";
import {
  findCouponUsageMismatches,
  findImpossibleEdges,
  findTotalMismatches,
  reconcile,
} from "@/domain/reconciliation";
import { getAvailability } from "@/domain/stock";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant } from "../helpers/factories";

/**
 * Editar un pedido antes del pago (plan-crecimiento §5.3).
 *
 * Es la fase que toca plata y stock a la vez, así que lo que se prueba acá es
 * lo que puede salir caro: que el precio unitario nunca se mueva, que las
 * reservas acompañen a las cantidades, que la edición **no** pueda tocar un
 * pedido ya cobrado, y que `pnpm reconcile` siga cuadrando después.
 */

const ACTOR = "admin:duena@tienda.py";

async function seedZone(
  pricePyg = 25_000,
  freeThresholdPyg: number | null = null
) {
  await getTestDb()
    .insert(shippingZones)
    .values({
      slug: "asuncion",
      name: "Asunción",
      cities: ["Asunción", "Luque"],
      pricePyg,
      freeThresholdPyg,
      position: 1,
    });
}

function input(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    items: [],
    customerName: "Rosa Giménez",
    customerPhone: "0981 123 456",
    docType: "NINGUNO",
    isConsumidorFinal: true,
    shipCity: "Asunción",
    shipAddress: "Av. Mcal. López 1234",
    paymentMethod: "transferencia",
    ...overrides,
  };
}

describe.skipIf(!hasTestDb)("editPendingOrder", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
    await seedZone();
  });

  afterAll(closeTestDb);

  /** Un pedido de transferencia con una línea de `qty` unidades. */
  async function unPedido(
    options: { qty?: number; onHand?: number; pricePyg?: number } = {}
  ) {
    const variantId = await createVariant({
      onHand: options.onHand ?? 10,
      pricePyg: options.pricePyg ?? 100_000,
    });
    const order = await placeOrder(
      input({ items: [{ variantId, qty: options.qty ?? 3 }] })
    );
    const [linea] = await getTestDb()
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.orderId));
    if (!linea) throw new Error("el pedido nació sin líneas");
    return {
      ...order,
      variantId,
      orderItemId: linea.id,
      unitPricePyg: linea.unitPricePyg,
    };
  }

  async function leer(orderId: number) {
    const [row] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row) throw new Error("pedido inexistente");
    return row;
  }

  async function reservado(
    orderId: number,
    variantId: number
  ): Promise<number> {
    const filas = await getTestDb()
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, orderId));
    return filas
      .filter((fila) => fila.variantId === variantId && fila.state === "held")
      .reduce((sum, fila) => sum + fila.qty, 0);
  }

  // -------------------------------------------------------------------------
  // Cantidades
  // -------------------------------------------------------------------------

  it("bajar una línea de 3 a 1 baja la reserva, el subtotal y el total", async () => {
    const pedido = await unPedido({ qty: 3, onHand: 10, pricePyg: 100_000 });
    expect(await reservado(pedido.orderId, pedido.variantId)).toBe(3);
    const disponibleAntes = await getAvailability(pedido.variantId);

    const resultado = await editPendingOrder({
      orderId: pedido.orderId,
      actor: ACTOR,
      items: [{ orderItemId: pedido.orderItemId, qty: 1 }],
      reason: "la compradora quiere una sola",
    });

    expect(resultado.subtotalPyg).toBe(100_000);
    expect(resultado.previousTotalPyg).toBe(325_000);
    expect(resultado.totalPyg).toBe(125_000);

    const row = await leer(pedido.orderId);
    expect(row.subtotalPyg).toBe(100_000);
    expect(row.totalPyg).toBe(125_000);
    // El precio unitario es el que ella vio: no se re-precia nada.
    const [linea] = await getTestDb()
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, pedido.orderId));
    expect(linea?.unitPricePyg).toBe(pedido.unitPricePyg);
    expect(linea?.qty).toBe(1);

    // Las dos unidades que ya no se venden vuelven a estar disponibles.
    expect(await reservado(pedido.orderId, pedido.variantId)).toBe(1);
    expect(await getAvailability(pedido.variantId)).toBe(disponibleAntes + 2);
  });

  it("quitar la única línea se rechaza: un pedido vacío es una cancelación con otro nombre", async () => {
    const pedido = await unPedido({ qty: 2 });

    await expect(
      editPendingOrder({
        orderId: pedido.orderId,
        actor: ACTOR,
        items: [{ orderItemId: pedido.orderItemId, qty: 0 }],
        reason: "ya no quiere nada",
      })
    ).rejects.toBeInstanceOf(EditOrderError);

    const row = await leer(pedido.orderId);
    expect(row.totalPyg).toBe(225_000);
    expect(await reservado(pedido.orderId, pedido.variantId)).toBe(2);
  });

  it("quitar una línea de dos deja el pedido con la otra, y suelta su reserva", async () => {
    const primeraVariante = await createVariant({
      onHand: 5,
      pricePyg: 100_000,
    });
    const segundaVariante = await createVariant({
      onHand: 5,
      pricePyg: 50_000,
    });
    const order = await placeOrder(
      input({
        items: [
          { variantId: primeraVariante, qty: 1 },
          { variantId: segundaVariante, qty: 2 },
        ],
      })
    );
    const lineas = await getTestDb()
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.orderId));
    const segunda = lineas.find((linea) => linea.variantId === segundaVariante);
    if (!segunda) throw new Error("falta la segunda línea");

    const resultado = await editPendingOrder({
      orderId: order.orderId,
      actor: ACTOR,
      items: [{ orderItemId: segunda.id, qty: 0 }],
      reason: "se arrepintió de las medias",
    });

    expect(resultado.lines).toHaveLength(1);
    expect(resultado.subtotalPyg).toBe(100_000);
    expect(await reservado(order.orderId, segundaVariante)).toBe(0);
    expect(await reservado(order.orderId, primeraVariante)).toBe(1);
  });

  it("subir una cantidad se rechaza: eso es un pedido nuevo", async () => {
    const pedido = await unPedido({ qty: 1, onHand: 10 });

    await expect(
      editPendingOrder({
        orderId: pedido.orderId,
        actor: ACTOR,
        items: [{ orderItemId: pedido.orderItemId, qty: 2 }],
        reason: "quiere una más",
      })
    ).rejects.toThrow(/sólo bajan/);

    expect(await reservado(pedido.orderId, pedido.variantId)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Quién no se puede editar
  // -------------------------------------------------------------------------

  it("un pedido con tarjeta no se edita", async () => {
    const variantId = await createVariant({ onHand: 5, pricePyg: 100_000 });
    const order = await placeOrder(
      input({ items: [{ variantId, qty: 2 }], paymentMethod: "tarjeta" })
    );
    const [linea] = await getTestDb()
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.orderId));

    await expect(
      editPendingOrder({
        orderId: order.orderId,
        actor: ACTOR,
        items: [{ orderItemId: linea?.id ?? 0, qty: 1 }],
        reason: "quiere una menos",
      })
    ).rejects.toThrow(/tarjeta/);

    const ficha = await getAdminOrder(order.orderId);
    expect(ficha?.editability).toEqual({ editable: false, reason: "tarjeta" });
  });

  it("un pedido con el pago ya acreditado no se edita", async () => {
    const pedido = await unPedido({ qty: 2 });
    await getTestDb().insert(payments).values({
      orderId: pedido.orderId,
      provider: "spi",
      providerRef: "transferencia-1",
      amountPyg: pedido.totalPyg,
      status: "paid",
    });

    await expect(
      editPendingOrder({
        orderId: pedido.orderId,
        actor: ACTOR,
        items: [{ orderItemId: pedido.orderItemId, qty: 1 }],
        reason: "quiere una menos",
      })
    ).rejects.toThrow(/pago acreditado/);

    const ficha = await getAdminOrder(pedido.orderId);
    expect(ficha?.editability).toEqual({ editable: false, reason: "pagado" });
  });

  it("la regla de la pantalla y la del dominio son la misma", () => {
    expect(
      canEditPendingOrder({
        status: "pendiente_pago",
        paymentMethod: "transferencia",
      })
    ).toEqual({ editable: true });
    expect(
      canEditPendingOrder({ status: "pagado", paymentMethod: "transferencia" })
    ).toEqual({
      editable: false,
      reason: "estado",
    });
  });

  // -------------------------------------------------------------------------
  // Envío y cupón
  // -------------------------------------------------------------------------

  it("cambiar de ciudad re-cotiza el envío", async () => {
    await getTestDb()
      .insert(shippingZones)
      .values({
        slug: "interior",
        name: "Interior",
        cities: ["Encarnación"],
        pricePyg: 60_000,
        freeThresholdPyg: null,
        position: 2,
      });

    const pedido = await unPedido({ qty: 1 });
    expect((await leer(pedido.orderId)).shippingPyg).toBe(25_000);

    const resultado = await editPendingOrder({
      orderId: pedido.orderId,
      actor: ACTOR,
      shipping: { city: "Encarnación", address: "Ruta 6 km 3" },
      reason: "se mudó antes de que salga",
    });

    expect(resultado.shippingPyg).toBe(60_000);
    const row = await leer(pedido.orderId);
    expect(row.shipCity).toBe("Encarnación");
    expect(row.shippingPyg).toBe(60_000);
    expect(row.totalPyg).toBe(
      row.subtotalPyg - row.discountPyg + row.shippingPyg
    );
  });

  it("el cupón que deja de llegar al mínimo se quita y se dice", async () => {
    await createCoupon({
      code: "MIL",
      type: "monto_fijo",
      value: 20_000,
      minOrderPyg: 250_000,
    });

    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });
    const order = await placeOrder(
      input({ items: [{ variantId, qty: 3 }], couponCode: "MIL" })
    );
    expect((await leer(order.orderId)).discountPyg).toBe(20_000);
    const [linea] = await getTestDb()
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.orderId));

    const resultado = await editPendingOrder({
      orderId: order.orderId,
      actor: ACTOR,
      items: [{ orderItemId: linea?.id ?? 0, qty: 1 }],
      reason: "quiere una sola",
    });

    expect(resultado.couponRemoved).toBe(true);
    expect(resultado.removedCouponCode).toBe("MIL");
    expect(resultado.discountPyg).toBe(0);

    const row = await leer(order.orderId);
    expect(row.discountPyg).toBe(0);
    expect(row.couponId).toBeNull();
    expect(row.totalPyg).toBe(row.subtotalPyg + row.shippingPyg);
  });

  it("un mínimo subido después de la compra no le quita el cupón a una edición que no baja el subtotal", async () => {
    await createCoupon({
      code: "DESC10",
      type: "porcentaje",
      value: 10,
      minOrderPyg: 200_000,
    });
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });
    const order = await placeOrder(
      input({ items: [{ variantId, qty: 3 }], couponCode: "DESC10" })
    );
    expect((await leer(order.orderId)).discountPyg).toBe(30_000);

    // El comercio sube el mínimo para los pedidos que vienen.
    await getTestDb()
      .update(coupons)
      .set({ minOrderPyg: 400_000 })
      .where(eq(coupons.code, "DESC10"));

    // Y a esta compradora sólo se le corrige la dirección.
    const resultado = await editPendingOrder({
      orderId: order.orderId,
      actor: ACTOR,
      shipping: { city: "Asunción", address: "Otra calle 123" },
      reason: "corrigió la dirección",
    });

    expect(resultado.couponRemoved).toBe(false);
    expect((await leer(order.orderId)).discountPyg).toBe(30_000);
  });

  it.each([
    { qty: 1, removed: true, timesUsed: 0 },
    { qty: 2, removed: false, timesUsed: 1 },
  ])(
    "editar a $qty unidades deja el uso del cupón en $timesUsed",
    async ({ qty, removed, timesUsed }) => {
      await createCoupon({
        code: "MINIMO",
        type: "monto_fijo",
        value: 20_000,
        minOrderPyg: 200_000,
      });
      const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });
      const order = await placeOrder(
        input({ items: [{ variantId, qty: 3 }], couponCode: "MINIMO" })
      );
      const db = getTestDb();
      const [antes] = await db
        .select()
        .from(coupons)
        .where(eq(coupons.code, "MINIMO"));
      expect(antes?.timesUsed).toBe(1);
      const [linea] = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.orderId));

      const resultado = await editPendingOrder({
        orderId: order.orderId,
        actor: ACTOR,
        items: [{ orderItemId: linea?.id ?? 0, qty }],
        reason: "quiere menos unidades",
      });

      expect(resultado.couponRemoved).toBe(removed);
      const [despues] = await db
        .select()
        .from(coupons)
        .where(eq(coupons.code, "MINIMO"));
      expect(despues?.timesUsed).toBe(timesUsed);
      expect(await findCouponUsageMismatches()).toEqual([]);
      if (removed) {
        const row = await leer(order.orderId);
        expect(row.couponId).toBeNull();
        expect(row.couponCode).toBeNull();
        expect(row.discountPyg).toBe(0);
      }
    }
  );

  it("el cupón que sigue aplicando se recalcula, no se quita", async () => {
    await createCoupon({ code: "DIEZ", type: "porcentaje", value: 10 });

    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });
    const order = await placeOrder(
      input({ items: [{ variantId, qty: 3 }], couponCode: "DIEZ" })
    );
    expect((await leer(order.orderId)).discountPyg).toBe(30_000);
    const [linea] = await getTestDb()
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.orderId));

    const resultado = await editPendingOrder({
      orderId: order.orderId,
      actor: ACTOR,
      items: [{ orderItemId: linea?.id ?? 0, qty: 2 }],
      reason: "quiere dos",
    });

    expect(resultado.couponRemoved).toBe(false);
    // 10 % sobre el subtotal nuevo, no el descuento viejo.
    expect(resultado.discountPyg).toBe(20_000);
    expect((await leer(order.orderId)).couponCode).toBe("DIEZ");
  });

  // -------------------------------------------------------------------------
  // Concurrencia, auditoría y reconciliación
  // -------------------------------------------------------------------------

  it("dos ediciones a la vez: la segunda decide sobre lo que dejó la primera", async () => {
    const pedido = await unPedido({ qty: 3 });

    const [primera, segunda] = await Promise.allSettled([
      editPendingOrder({
        orderId: pedido.orderId,
        actor: ACTOR,
        items: [{ orderItemId: pedido.orderItemId, qty: 2 }],
        reason: "quiere dos",
      }),
      editPendingOrder({
        orderId: pedido.orderId,
        actor: ACTOR,
        items: [{ orderItemId: pedido.orderItemId, qty: 2 }],
        reason: "quiere dos (doble click)",
      }),
    ]);

    // La segunda corre con la fila ya bloqueada por la primera, así que ve el
    // estado nuevo: bajar a 2 lo que ya está en 2 es un no-op, nunca un 4.
    expect([primera.status, segunda.status]).not.toContain("rejected");
    const row = await leer(pedido.orderId);
    expect(row.subtotalPyg).toBe(200_000);
    expect(await reservado(pedido.orderId, pedido.variantId)).toBe(2);
  });

  it("deja una fila de auditoría con el prefijo, y reconcile no la ve como arista imposible", async () => {
    const pedido = await unPedido({ qty: 3 });

    await editPendingOrder({
      orderId: pedido.orderId,
      actor: ACTOR,
      actorUserId: null,
      items: [{ orderItemId: pedido.orderItemId, qty: 1 }],
      reason: "la compradora quiere una sola",
    });

    const eventos = await getTestDb()
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, pedido.orderId));
    const edicion = eventos.find((evento) =>
      evento.reason?.startsWith(EDIT_ORDER_REASON_PREFIX)
    );

    expect(edicion).toBeDefined();
    // No es una transición: el estado no se movió.
    expect(edicion?.fromStatus).toBe("pendiente_pago");
    expect(edicion?.toStatus).toBe("pendiente_pago");
    expect(edicion?.actor).toBe(ACTOR);
    expect(edicion?.reason).toContain("total ");

    expect(await findImpossibleEdges()).toEqual([]);
    const report = await reconcile();
    expect(report.ok).toBe(true);
  });

  it("reconcile sigue atrapando un total torcido después de una edición", async () => {
    const pedido = await unPedido({ qty: 3 });
    await editPendingOrder({
      orderId: pedido.orderId,
      actor: ACTOR,
      items: [{ orderItemId: pedido.orderItemId, qty: 1 }],
      reason: "quiere una sola",
    });
    expect(await findTotalMismatches()).toEqual([]);

    // Se fuerza a mano lo que ninguna escritura del dominio puede hacer.
    await getTestDb()
      .update(orders)
      .set({ totalPyg: 999_999 })
      .where(eq(orders.id, pedido.orderId));

    const desvios = await findTotalMismatches();
    expect(desvios.map((fila) => fila.orderId)).toContain(pedido.orderId);
  });

  it("sin motivo no se edita: la historia del pedido tiene que decir por qué", async () => {
    const pedido = await unPedido({ qty: 2 });

    await expect(
      editPendingOrder({
        orderId: pedido.orderId,
        actor: ACTOR,
        items: [{ orderItemId: pedido.orderItemId, qty: 1 }],
        reason: "  ",
      })
    ).rejects.toBeInstanceOf(EditOrderError);
  });

  it("editar no le regala tiempo: `reserved_until` no se mueve", async () => {
    const pedido = await unPedido({ qty: 3 });
    const antes = (await leer(pedido.orderId)).reservedUntil;

    await editPendingOrder({
      orderId: pedido.orderId,
      actor: ACTOR,
      items: [{ orderItemId: pedido.orderItemId, qty: 2 }],
      reason: "quiere dos",
    });

    expect((await leer(pedido.orderId)).reservedUntil?.getTime()).toBe(
      antes?.getTime()
    );
  });
});
