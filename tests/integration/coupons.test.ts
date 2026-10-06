import { seedPaymentReadiness } from "../helpers/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { coupons, orders, shippingZones, type CouponType } from "@/db/schema";
import {
  createCoupon,
  updateCoupon,
  AdminCouponError,
} from "@/domain/admin-coupons";
import {
  CouponRejectedError,
  createOrder,
  type CreateOrderInput,
} from "@/domain/create-order";
import { hasUsableCoupons, validateCoupon } from "@/domain/coupons";
import { registerCustomer } from "@/domain/customers";
import { computeOrderTotals } from "@/domain/order-totals";
import { reconcile } from "@/domain/reconciliation";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant } from "../helpers/factories";

/**
 * Cupones contra MySQL (PLAN.md FASE 2, PR G).
 *
 * Tres cosas se prueban acá y no en los unitarios porque no se pueden simular:
 * la carrera de dos checkouts por el último uso (`FOR UPDATE`), que
 * `pnpm reconcile` siga cuadrando con descuentos, y que el descuento llegue a
 * la fila del pedido.
 */

const DIA = 24 * 60 * 60 * 1000;

async function seedZone(pricePyg = 25_000) {
  await getTestDb()
    .insert(shippingZones)
    .values({
      slug: "asuncion",
      name: "Asunción",
      cities: ["Asunción"],
      pricePyg,
      // Sin umbral: el envío gratis tiene su propia interacción con el descuento
      // y se prueba aparte.
      freeThresholdPyg: null,
      position: 1,
    });
}

async function unCupon(
  overrides: Partial<Parameters<typeof createCoupon>[0]> = {}
) {
  return createCoupon({
    code: overrides.code ?? "BIENVENIDA",
    type: (overrides.type ?? "porcentaje") as CouponType,
    value: overrides.value ?? 10,
    minOrderPyg: overrides.minOrderPyg,
    startsAt: overrides.startsAt,
    endsAt: overrides.endsAt,
    maxUses: overrides.maxUses,
    maxUsesPerCustomer: overrides.maxUsesPerCustomer,
    soloClientes: overrides.soloClientes,
    isActive: overrides.isActive,
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

describe.skipIf(!hasTestDb)("validación del cupón", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
    await seedZone();
  });
  afterAll(closeTestDb);

  it("un código inexistente no valida", async () => {
    const result = await validateCoupon("NOEXISTE", { subtotalPyg: 100_000 });
    expect(result).toMatchObject({ ok: false, reason: "no_existe" });
  });

  it("el código no distingue mayúsculas ni espacios", async () => {
    await unCupon({ code: "BIENVENIDA" });
    const result = await validateCoupon("  bienvenida ", {
      subtotalPyg: 100_000,
    });
    expect(result.ok).toBe(true);
  });

  it("un cupón desactivado no valida", async () => {
    const id = await unCupon();
    await getTestDb()
      .update(coupons)
      .set({ isActive: false })
      .where(eq(coupons.id, id));

    const result = await validateCoupon("BIENVENIDA", { subtotalPyg: 100_000 });
    expect(result).toMatchObject({ ok: false, reason: "inactivo" });
  });

  it("respeta la vigencia por los dos lados", async () => {
    await unCupon({ code: "FUTURO", startsAt: new Date(Date.now() + DIA) });
    await unCupon({ code: "PASADO", endsAt: new Date(Date.now() - DIA) });

    expect(
      await validateCoupon("FUTURO", { subtotalPyg: 100_000 })
    ).toMatchObject({
      ok: false,
      reason: "no_empezo",
    });
    expect(
      await validateCoupon("PASADO", { subtotalPyg: 100_000 })
    ).toMatchObject({
      ok: false,
      reason: "vencido",
    });
  });

  it("el mínimo se mira contra el subtotal y dice cuál era", async () => {
    await unCupon({ minOrderPyg: 200_000 });

    const result = await validateCoupon("BIENVENIDA", { subtotalPyg: 150_000 });
    expect(result).toMatchObject({
      ok: false,
      reason: "minimo_no_alcanzado",
      minOrderPyg: 200_000,
    });
  });

  it("un cupón agotado no valida", async () => {
    const id = await unCupon({ maxUses: 1 });
    await getTestDb()
      .update(coupons)
      .set({ timesUsed: 1 })
      .where(eq(coupons.id, id));

    expect(
      await validateCoupon("BIENVENIDA", { subtotalPyg: 100_000 })
    ).toMatchObject({
      ok: false,
      reason: "agotado",
    });
  });

  it("`solo_clientes` no valida sin sesión de cliente", async () => {
    await unCupon({ soloClientes: true });

    // Es el caso de una tienda con las cuentas apagadas: nadie tiene
    // `customerId`, así que estos cupones degradan solos.
    expect(
      await validateCoupon("BIENVENIDA", { subtotalPyg: 100_000 })
    ).toMatchObject({
      ok: false,
      reason: "solo_clientes",
    });
  });

  it("`solo_clientes` valida con cuenta", async () => {
    await unCupon({ soloClientes: true });
    const customer = await registerCustomer({
      phone: "0981 123 456",
      password: "tienda2026segura",
      name: "Rosa Giménez",
    });

    const result = await validateCoupon("BIENVENIDA", {
      subtotalPyg: 100_000,
      customerId: customer.id,
    });
    expect(result.ok).toBe(true);
  });
});

describe.skipIf(!hasTestDb)("el descuento en el total", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
    await seedZone(25_000);
  });
  afterAll(closeTestDb);

  it("sale del subtotal y nunca del envío", async () => {
    await unCupon({ type: "monto_fijo", value: 30_000 });
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });

    const totals = await computeOrderTotals(
      [{ variantId, qty: 1 }],
      "Asunción",
      {
        couponCode: "BIENVENIDA",
      }
    );

    expect(totals.subtotalPyg).toBe(100_000);
    expect(totals.discountPyg).toBe(30_000);
    expect(totals.shippingPyg).toBe(25_000);
    // La identidad que verifica `pnpm reconcile`.
    expect(totals.totalPyg).toBe(100_000 - 30_000 + 25_000);
  });

  it("un código que no sirve deja el total sin tocar y dice por qué", async () => {
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });

    const totals = await computeOrderTotals(
      [{ variantId, qty: 1 }],
      "Asunción",
      {
        couponCode: "NOEXISTE",
      }
    );

    expect(totals.discountPyg).toBe(0);
    expect(totals.couponRejection).toBe("no_existe");
    expect(totals.totalPyg).toBe(125_000);
  });

  it("el descuento no le saca el envío gratis que ya tenía", async () => {
    // Umbral de ₲500.000: con el descuento el subtotal "cae" abajo del umbral.
    // Un cupón nunca puede empeorar el total, así que el envío sigue gratis.
    await getTestDb().update(shippingZones).set({ freeThresholdPyg: 500_000 });
    await unCupon({ type: "monto_fijo", value: 100_000 });
    const variantId = await createVariant({ onHand: 10, pricePyg: 500_000 });

    const totals = await computeOrderTotals(
      [{ variantId, qty: 1 }],
      "Asunción",
      {
        couponCode: "BIENVENIDA",
      }
    );

    expect(totals.shippingPyg).toBe(0);
    expect(totals.totalPyg).toBe(400_000);
  });

  it("el pedido guarda el descuento, el id y el código", async () => {
    const couponId = await unCupon({ type: "monto_fijo", value: 30_000 });
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });

    const order = await createOrder(
      input({ items: [{ variantId, qty: 1 }], couponCode: "bienvenida" })
    );

    const [row] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, order.orderId));
    expect(row?.discountPyg).toBe(30_000);
    expect(row?.couponId).toBe(couponId);
    // Snapshot en mayúsculas: es lo que explica el total dentro de seis meses.
    expect(row?.couponCode).toBe("BIENVENIDA");
    expect(row?.totalPyg).toBe(95_000);
  });

  it("sin cupón el pedido queda exactamente como siempre", async () => {
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });
    const order = await createOrder(input({ items: [{ variantId, qty: 1 }] }));

    const [row] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, order.orderId));
    expect(row?.discountPyg).toBe(0);
    expect(row?.couponId).toBeNull();
    expect(row?.couponCode).toBeNull();
    expect(row?.totalPyg).toBe(125_000);
  });

  it("un código que dejó de servir frena el pedido en vez de cobrar de más", async () => {
    const id = await unCupon({ type: "monto_fijo", value: 30_000 });
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });

    await getTestDb()
      .update(coupons)
      .set({ isActive: false })
      .where(eq(coupons.id, id));

    // Confirmó contando con el descuento: cobrarle el precio entero sin avisar
    // es la clase de sorpresa que hace que no vuelva.
    await expect(
      createOrder(
        input({ items: [{ variantId, qty: 1 }], couponCode: "BIENVENIDA" })
      )
    ).rejects.toThrow(CouponRejectedError);

    expect(await getTestDb().select().from(orders)).toHaveLength(0);
  });

  it("el tope por cliente cuenta los pedidos de ese WhatsApp", async () => {
    await unCupon({ type: "monto_fijo", value: 10_000, maxUsesPerCustomer: 1 });
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });

    await createOrder(
      input({ items: [{ variantId, qty: 1 }], couponCode: "BIENVENIDA" })
    );

    await expect(
      createOrder(
        input({ items: [{ variantId, qty: 1 }], couponCode: "BIENVENIDA" })
      )
    ).rejects.toThrow(CouponRejectedError);

    // Otra persona sí puede usarlo.
    const otra = await createOrder(
      input({
        items: [{ variantId, qty: 1 }],
        couponCode: "BIENVENIDA",
        customerPhone: "0982 999 888",
      })
    );
    expect(otra.orderId).toBeGreaterThan(0);
  });
});

/**
 * La carrera que pide el plan (G.5): dos checkouts al mismo tiempo por el
 * último uso de un cupón. Sin `FOR UPDATE` los dos leen `times_used = 0`, los
 * dos pasan la validación y los dos cobran el descuento.
 */
describe.skipIf(!hasTestDb)("concurrencia: el cupón de un solo uso", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
    await seedZone();
  });
  afterAll(closeTestDb);

  it("dos checkouts simultáneos no lo gastan dos veces", async () => {
    await unCupon({ type: "monto_fijo", value: 30_000, maxUses: 1 });
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });

    const resultados = await Promise.allSettled([
      createOrder(
        input({
          items: [{ variantId, qty: 1 }],
          couponCode: "BIENVENIDA",
          customerPhone: "0981 111 111",
        })
      ),
      createOrder(
        input({
          items: [{ variantId, qty: 1 }],
          couponCode: "BIENVENIDA",
          customerPhone: "0982 222 222",
        })
      ),
    ]);

    const ganadores = resultados.filter((r) => r.status === "fulfilled");
    const perdedores = resultados.filter((r) => r.status === "rejected");

    // Exactamente uno gana. Nunca se afirma **cuál**: eso es lo único que
    // legítimamente puede variar entre corridas.
    expect(ganadores).toHaveLength(1);
    expect(perdedores).toHaveLength(1);

    const [row] = await getTestDb().select().from(coupons);
    expect(row?.timesUsed).toBe(1);

    // Y el que perdió perdió limpio: no quedó su pedido a medias.
    const conDescuento = await getTestDb()
      .select()
      .from(orders)
      .where(sql`${orders.discountPyg} > 0`);
    expect(conDescuento).toHaveLength(1);
  });

  it("el mismo WhatsApp en dos checkouts simultáneos no pasa el tope por cliente", async () => {
    // Sin tope global: lo único que frena es `maxUsesPerCustomer`. La cuenta
    // de usos tiene que leer lo último commiteado (lectura con candado), no la
    // foto de la transacción, que se tomó antes de esperar el candado.
    await unCupon({ type: "monto_fijo", value: 10_000, maxUsesPerCustomer: 1 });
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });

    const resultados = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        createOrder(
          input({ items: [{ variantId, qty: 1 }], couponCode: "BIENVENIDA" })
        )
      )
    );

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const conDescuento = await getTestDb()
      .select()
      .from(orders)
      .where(sql`${orders.discountPyg} > 0`);
    expect(conDescuento).toHaveLength(1);
  });

  it("cinco simultáneos con tope de dos: gastan exactamente dos", async () => {
    await unCupon({ type: "monto_fijo", value: 10_000, maxUses: 2 });
    const variantId = await createVariant({ onHand: 50, pricePyg: 100_000 });

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        createOrder(
          input({
            items: [{ variantId, qty: 1 }],
            couponCode: "BIENVENIDA",
            customerPhone: `098${i} 111 22${i}`,
          })
        )
      )
    );

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(2);

    const [row] = await getTestDb().select().from(coupons);
    expect(row?.timesUsed).toBe(2);
  });
});

describe.skipIf(!hasTestDb)("reconcile con descuentos", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
    await seedZone();
  });
  afterAll(closeTestDb);

  it("un pedido con descuento cuadra", async () => {
    await unCupon({ type: "monto_fijo", value: 30_000 });
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });

    await createOrder(
      input({ items: [{ variantId, qty: 1 }], couponCode: "BIENVENIDA" })
    );

    const report = await reconcile();
    expect(report.totalMismatches).toEqual([]);
    expect(report.crossChecks).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("un descuento escrito a mano, sin cupón, se reporta", async () => {
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });
    const order = await createOrder(input({ items: [{ variantId, qty: 1 }] }));

    // Alguien bajándole el total a un pedido por fuera de `computeOrderTotals`:
    // exactamente lo que este control existe para encontrar.
    await getTestDb()
      .update(orders)
      .set({ discountPyg: 20_000, totalPyg: 105_000 })
      .where(eq(orders.id, order.orderId));

    const report = await reconcile();
    expect(report.ok).toBe(false);
    expect(report.crossChecks.map((f) => f.kind)).toContain(
      "descuento_sin_cupon"
    );
  });

  it("un total que no respeta subtotal − descuento + envío se reporta", async () => {
    await unCupon({ type: "monto_fijo", value: 30_000 });
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });
    const order = await createOrder(
      input({ items: [{ variantId, qty: 1 }], couponCode: "BIENVENIDA" })
    );

    await getTestDb()
      .update(orders)
      .set({ totalPyg: 125_000 })
      .where(eq(orders.id, order.orderId));

    const report = await reconcile();
    expect(report.ok).toBe(false);
    expect(report.totalMismatches).toHaveLength(1);
  });

  it("el contador del cupón despegado de los pedidos se reporta", async () => {
    const id = await unCupon({ type: "monto_fijo", value: 30_000 });
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });
    await createOrder(
      input({ items: [{ variantId, qty: 1 }], couponCode: "BIENVENIDA" })
    );

    await getTestDb()
      .update(coupons)
      .set({ timesUsed: 7 })
      .where(eq(coupons.id, id));

    const report = await reconcile();
    expect(report.ok).toBe(false);
    expect(report.crossChecks.map((f) => f.kind)).toContain(
      "usos_del_cupon_no_cuadran"
    );
  });

  it("un descuento mayor que el subtotal se reporta", async () => {
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });
    const order = await createOrder(input({ items: [{ variantId, qty: 1 }] }));

    await getTestDb()
      .update(orders)
      .set({ discountPyg: 200_000, couponCode: "RARO", totalPyg: 0 })
      .where(eq(orders.id, order.orderId));

    const report = await reconcile();
    expect(report.crossChecks.map((f) => f.kind)).toContain(
      "descuento_mayor_al_subtotal"
    );
  });
});

describe.skipIf(!hasTestDb)("cero cupones = invisible", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
    await seedZone();
  });
  afterAll(closeTestDb);

  it("sin cupones, el checkout no ofrece el campo", async () => {
    expect(await hasUsableCoupons()).toBe(false);
  });

  it("con uno activo y vigente, sí", async () => {
    await unCupon();
    expect(await hasUsableCoupons()).toBe(true);
  });

  it("un cupón vencido o agotado no cuenta: sólo podría fallar", async () => {
    const vencido = await unCupon({
      code: "VIEJO",
      endsAt: new Date(Date.now() - DIA),
    });
    expect(await hasUsableCoupons()).toBe(false);

    await getTestDb()
      .update(coupons)
      .set({ isActive: false })
      .where(eq(coupons.id, vencido));
    const agotado = await unCupon({ code: "AGOTADO", maxUses: 1 });
    await getTestDb()
      .update(coupons)
      .set({ timesUsed: 1 })
      .where(eq(coupons.id, agotado));

    expect(await hasUsableCoupons()).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("ABM del panel", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
    await seedZone();
  });
  afterAll(closeTestDb);

  it("rechaza un porcentaje mayor que 100", async () => {
    await expect(unCupon({ type: "porcentaje", value: 150 })).rejects.toThrow(
      AdminCouponError
    );
  });

  it("rechaza valores que no son enteros positivos", async () => {
    await expect(unCupon({ value: 0 })).rejects.toThrow(AdminCouponError);
    await expect(unCupon({ value: 10.5 })).rejects.toThrow(AdminCouponError);
  });

  it("no deja dos cupones con el mismo código", async () => {
    await unCupon({ code: "REPETIDO" });
    await expect(unCupon({ code: "repetido" })).rejects.toThrow(
      AdminCouponError
    );
  });

  it("no deja cambiarle el descuento a un cupón ya usado", async () => {
    const id = await unCupon({ type: "monto_fijo", value: 30_000 });
    const variantId = await createVariant({ onHand: 10, pricePyg: 100_000 });
    await createOrder(
      input({ items: [{ variantId, qty: 1 }], couponCode: "BIENVENIDA" })
    );

    // Cambiarle el valor a un cupón con pedidos encima deja esos totales sin
    // explicación posible.
    await expect(
      updateCoupon(id, {
        code: "BIENVENIDA",
        type: "monto_fijo",
        value: 90_000,
      })
    ).rejects.toThrow(AdminCouponError);

    // Pero desactivarlo o correrle la vigencia sí se puede.
    await updateCoupon(id, {
      code: "BIENVENIDA",
      type: "monto_fijo",
      value: 30_000,
      isActive: false,
    });
    const [row] = await getTestDb()
      .select()
      .from(coupons)
      .where(eq(coupons.id, id));
    expect(row?.isActive).toBe(false);
  });
});
