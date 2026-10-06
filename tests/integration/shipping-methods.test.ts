import { seedPaymentReadiness } from "../helpers/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  orderEvents,
  orders,
  shippingMethods,
  shippingZones,
} from "@/db/schema";
import {
  AdminShippingMethodError,
  createShippingMethod,
  listAdminShippingMethods,
  setShippingMethodActive,
  updateShippingMethod,
} from "@/domain/admin-shipping-methods";
import {
  CheckoutError,
  PaymentMethodNotAllowedError,
  ShippingMethodRejectedError,
  TotalChangedError,
  createOrder,
  type CreateOrderInput,
} from "@/domain/create-order";
import { computeOrderTotals } from "@/domain/order-totals";
import { quoteShippingMethods } from "@/domain/shipping";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant } from "../helpers/factories";

/**
 * Métodos de envío, contra MySQL de verdad (FASE 3).
 *
 * Lo de acá no se puede simular: `createOrder` re-valida el método **adentro
 * de su transacción** y re-cotiza el precio del lado del servidor. Los cuatro
 * casos que importan son los cuatro modos de perder plata o de prometer una
 * entrega que no existe:
 *
 * 1. el método que mandó el navegador ya no sirve,
 * 2. el medio de pago que eligió no lo acepta ese método,
 * 3. el precio que tenía en pantalla no es el que corresponde cobrar,
 * 4. retiro en el local cobrando flete.
 *
 * Y el quinto, el que protege a todas las tiendas que ya están vendiendo: sin
 * ninguna fila en la tabla, el checkout es exactamente el de antes.
 */

async function seedZonas() {
  const db = getTestDb();
  await db.insert(shippingZones).values([
    {
      slug: "asuncion",
      name: "Asunción",
      cities: ["Asunción"],
      pricePyg: 25_000,
      freeThresholdPyg: 500_000,
      position: 0,
    },
    {
      slug: "interior",
      name: "Interior",
      cities: ["Encarnación"],
      pricePyg: 60_000,
      freeThresholdPyg: null,
      position: 1,
    },
  ]);

  const filas = await db.select().from(shippingZones);
  const asuncion = filas.find((zona) => zona.slug === "asuncion")!;
  const interior = filas.find((zona) => zona.slug === "interior")!;
  return { asuncionId: asuncion.id, interiorId: interior.id };
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

describe.skipIf(!hasTestDb)("createOrder con métodos de envío", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
  });
  afterAll(closeTestDb);

  it("sin métodos configurados cobra la zona y guarda el nombre implícito", async () => {
    // El estado de toda tienda ya clonada. Si esto cambia, se rompe la
    // actualización de todas las tiendas que ya están vendiendo.
    await seedZonas();
    const variantId = await createVariant({ onHand: 5, pricePyg: 100_000 });

    const order = await createOrder(input({ items: [{ variantId, qty: 1 }] }));

    expect(order.shippingPyg).toBe(25_000);
    expect(order.totalPyg).toBe(125_000);

    const [fila] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, order.orderId));
    expect(fila?.shippingMethodId).toBeNull();
    expect(fila?.shippingMethodName).toBe("Envío a domicilio");
  });

  it("sin métodos configurados los tres medios de pago siguen habilitados", async () => {
    await seedZonas();
    const variantId = await createVariant({ onHand: 5, pricePyg: 100_000 });

    for (const paymentMethod of [
      "transferencia",
      "contra_entrega",
      "tarjeta",
    ] as const) {
      const order = await createOrder(
        input({ items: [{ variantId, qty: 1 }], paymentMethod })
      );
      expect(order.shippingPyg).toBe(25_000);
    }
  });

  it("cobra la tarifa plana del método elegido, no la de la zona", async () => {
    const { asuncionId } = await seedZonas();
    const variantId = await createVariant({ onHand: 5, pricePyg: 100_000 });

    await createShippingMethod({
      name: "Courier nacional",
      kind: "courier",
      pricing: "zona",
      fixedPricePyg: null,
      zoneIds: [],
      allowedPaymentMethods: ["transferencia", "tarjeta"],
    });
    const moto = await createShippingMethod({
      name: "Moto Asunción",
      kind: "local",
      pricing: "fijo",
      fixedPricePyg: 15_000,
      zoneIds: [asuncionId],
      allowedPaymentMethods: ["contra_entrega", "transferencia"],
    });

    const order = await createOrder(
      input({
        items: [{ variantId, qty: 1 }],
        shippingMethodId: moto.id,
        paymentMethod: "contra_entrega",
      })
    );

    expect(order.shippingPyg).toBe(15_000);
    expect(order.totalPyg).toBe(115_000);

    const [fila] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, order.orderId));
    expect(fila?.shippingMethodId).toBe(moto.id);
    expect(fila?.shippingMethodName).toBe("Moto Asunción");
  });

  it("retiro en el local no cobra flete", async () => {
    await seedZonas();
    const variantId = await createVariant({ onHand: 5, pricePyg: 100_000 });

    const retiro = await createShippingMethod({
      name: "Retiro en el local",
      kind: "retiro",
      // A propósito con datos incoherentes: el dominio los normaliza y el
      // pedido tiene que salir en ₲0 igual.
      pricing: "zona",
      fixedPricePyg: 99_000,
      zoneIds: [],
      allowedPaymentMethods: ["transferencia", "contra_entrega"],
    });

    const order = await createOrder(
      input({ items: [{ variantId, qty: 1 }], shippingMethodId: retiro.id })
    );

    expect(order.shippingPyg).toBe(0);
    expect(order.totalPyg).toBe(100_000);
  });

  it("rechaza un método que no aplica a esa ciudad, sin crear el pedido", async () => {
    const { asuncionId } = await seedZonas();
    const variantId = await createVariant({ onHand: 5, pricePyg: 100_000 });

    const moto = await createShippingMethod({
      name: "Moto Asunción",
      kind: "local",
      pricing: "fijo",
      fixedPricePyg: 15_000,
      zoneIds: [asuncionId],
      allowedPaymentMethods: ["contra_entrega"],
    });
    await createShippingMethod({
      name: "Courier nacional",
      kind: "courier",
      pricing: "zona",
      fixedPricePyg: null,
      zoneIds: [],
      allowedPaymentMethods: ["transferencia"],
    });

    await expect(
      createOrder(
        input({
          items: [{ variantId, qty: 1 }],
          shipCity: "Encarnación",
          shippingMethodId: moto.id,
          paymentMethod: "contra_entrega",
        })
      )
    ).rejects.toBeInstanceOf(ShippingMethodRejectedError);

    // Ni pedido, ni número consumido, ni reserva: es un error del dominio y no
    // un 500 a mitad de camino.
    expect(await getTestDb().select().from(orders)).toHaveLength(0);
  });

  it("rechaza un método desactivado entre la pantalla y el submit", async () => {
    await seedZonas();
    const variantId = await createVariant({ onHand: 5, pricePyg: 100_000 });

    const courier = await createShippingMethod({
      name: "Courier nacional",
      kind: "courier",
      pricing: "zona",
      fixedPricePyg: null,
      zoneIds: [],
      allowedPaymentMethods: ["transferencia"],
    });
    await createShippingMethod({
      name: "Moto Asunción",
      kind: "local",
      pricing: "fijo",
      fixedPricePyg: 15_000,
      zoneIds: [],
      allowedPaymentMethods: ["transferencia"],
    });
    await setShippingMethodActive({ methodId: courier.id, isActive: false });

    await expect(
      createOrder(
        input({ items: [{ variantId, qty: 1 }], shippingMethodId: courier.id })
      )
    ).rejects.toBeInstanceOf(ShippingMethodRejectedError);
  });

  it("rechaza el pedido cuando el método no acepta ese medio de pago", async () => {
    await seedZonas();
    const variantId = await createVariant({ onHand: 5, pricePyg: 100_000 });

    const courier = await createShippingMethod({
      name: "Courier nacional",
      kind: "courier",
      pricing: "zona",
      fixedPricePyg: null,
      zoneIds: [],
      // El courier no está en la puerta para cobrar en efectivo: ésta es la
      // regla que da sentido a toda la tabla.
      allowedPaymentMethods: ["transferencia", "tarjeta"],
    });

    const promesa = createOrder(
      input({
        items: [{ variantId, qty: 1 }],
        shippingMethodId: courier.id,
        paymentMethod: "contra_entrega",
      })
    );

    await expect(promesa).rejects.toBeInstanceOf(PaymentMethodNotAllowedError);
    await expect(promesa).rejects.toBeInstanceOf(CheckoutError);
    expect(await getTestDb().select().from(orders)).toHaveLength(0);
  });

  it("no cobra el precio que mandó el navegador: avisa que el total cambió", async () => {
    const { asuncionId } = await seedZonas();
    const variantId = await createVariant({ onHand: 5, pricePyg: 100_000 });

    const courier = await createShippingMethod({
      name: "Courier nacional",
      kind: "courier",
      pricing: "zona",
      fixedPricePyg: null,
      zoneIds: [],
      allowedPaymentMethods: ["transferencia"],
    });
    await createShippingMethod({
      name: "Moto Asunción",
      kind: "local",
      pricing: "fijo",
      fixedPricePyg: 15_000,
      zoneIds: [asuncionId],
      allowedPaymentMethods: ["transferencia"],
    });

    // El navegador dice "el courier me sale ₲115.000" (el precio de la moto).
    // El servidor cotiza ₲125.000 y no cobra ninguno de los dos números que
    // vinieron del navegador: tira, y la pantalla vuelve a preguntar.
    const promesa = createOrder(
      input({
        items: [{ variantId, qty: 1 }],
        shippingMethodId: courier.id,
        expectedTotalPyg: 115_000,
      })
    );

    await expect(promesa).rejects.toBeInstanceOf(TotalChangedError);
    await expect(promesa).rejects.toMatchObject({
      before: 115_000,
      after: 125_000,
    });
    expect(await getTestDb().select().from(orders)).toHaveLength(0);
  });

  it("sin ningún método válido para la ciudad no se puede comprar, y lo dice", async () => {
    const { asuncionId } = await seedZonas();
    const variantId = await createVariant({ onHand: 5, pricePyg: 100_000 });

    await createShippingMethod({
      name: "Moto Asunción",
      kind: "local",
      pricing: "fijo",
      fixedPricePyg: 15_000,
      zoneIds: [asuncionId],
      allowedPaymentMethods: ["contra_entrega"],
    });

    await expect(
      createOrder(
        input({ items: [{ variantId, qty: 1 }], shipCity: "Encarnación" })
      )
    ).rejects.toMatchObject({ reason: "sin_metodos" });
  });

  it("el evento del pedido deja escrito con qué método se creó", async () => {
    await seedZonas();
    const variantId = await createVariant({ onHand: 5, pricePyg: 100_000 });

    const retiro = await createShippingMethod({
      name: "Retiro en el local",
      kind: "retiro",
      pricing: "fijo",
      fixedPricePyg: 0,
      zoneIds: [],
      allowedPaymentMethods: ["transferencia"],
    });

    const order = await createOrder(
      input({ items: [{ variantId, qty: 1 }], shippingMethodId: retiro.id })
    );

    const [evento] = await getTestDb()
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, order.orderId));
    expect(evento?.reason).toContain("Retiro en el local");
  });
});

describe.skipIf(!hasTestDb)(
  "la cotización y el cobro son la misma función",
  () => {
    beforeEach(async () => {
      await resetTables();
      await seedPaymentReadiness();
    });
    afterAll(closeTestDb);

    it("el total cotizado con un método es el que después se cobra", async () => {
      const { asuncionId } = await seedZonas();
      const variantId = await createVariant({ onHand: 5, pricePyg: 100_000 });

      const moto = await createShippingMethod({
        name: "Moto Asunción",
        kind: "local",
        pricing: "fijo",
        fixedPricePyg: 15_000,
        zoneIds: [asuncionId],
        allowedPaymentMethods: ["contra_entrega"],
      });

      const cotizado = await computeOrderTotals(
        [{ variantId, qty: 1 }],
        "Asunción",
        {
          shippingMethodId: moto.id,
        }
      );
      const order = await createOrder(
        input({
          items: [{ variantId, qty: 1 }],
          shippingMethodId: moto.id,
          paymentMethod: "contra_entrega",
          expectedTotalPyg: cotizado.totalPyg,
        })
      );

      expect(order.totalPyg).toBe(cotizado.totalPyg);
    });

    it("quoteShippingMethods devuelve los válidos para la ciudad, ya cotizados", async () => {
      const { asuncionId, interiorId } = await seedZonas();

      await createShippingMethod({
        name: "Courier nacional",
        kind: "courier",
        pricing: "zona",
        fixedPricePyg: null,
        zoneIds: [],
        allowedPaymentMethods: ["transferencia"],
      });
      await createShippingMethod({
        name: "Moto Asunción",
        kind: "local",
        pricing: "fijo",
        fixedPricePyg: 15_000,
        zoneIds: [asuncionId],
        allowedPaymentMethods: ["contra_entrega"],
      });
      await createShippingMethod({
        name: "Moto Encarnación",
        kind: "local",
        pricing: "fijo",
        fixedPricePyg: 12_000,
        zoneIds: [interiorId],
        allowedPaymentMethods: ["contra_entrega"],
      });

      const asuncion = await quoteShippingMethods("Asunción", 100_000);
      expect(
        asuncion.methods.map((method) => [method.name, method.shippingPyg])
      ).toEqual([
        ["Courier nacional", 25_000],
        ["Moto Asunción", 15_000],
      ]);

      const encarnacion = await quoteShippingMethods("Encarnación", 100_000);
      expect(
        encarnacion.methods.map((method) => [method.name, method.shippingPyg])
      ).toEqual([
        ["Courier nacional", 60_000],
        ["Moto Encarnación", 12_000],
      ]);
    });

    it("el umbral de envío gratis de la zona se conserva con `pricing = zona`", async () => {
      await seedZonas();

      await createShippingMethod({
        name: "Courier nacional",
        kind: "courier",
        pricing: "zona",
        fixedPricePyg: null,
        zoneIds: [],
        allowedPaymentMethods: ["transferencia"],
      });

      const chico = await quoteShippingMethods("Asunción", 100_000);
      expect(chico.methods[0]?.shippingPyg).toBe(25_000);

      const grande = await quoteShippingMethods("Asunción", 500_000);
      expect(grande.methods[0]).toMatchObject({ shippingPyg: 0, isFree: true });
    });
  }
);

describe.skipIf(!hasTestDb)("ABM de métodos de envío", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
  });
  afterAll(closeTestDb);

  it("normaliza retiro: sin zonas, sin tarifa y en ₲0", async () => {
    const { asuncionId } = await seedZonas();

    const retiro = await createShippingMethod({
      name: "Retiro en el local",
      kind: "retiro",
      pricing: "zona",
      fixedPricePyg: 40_000,
      zoneIds: [asuncionId],
      allowedPaymentMethods: ["transferencia"],
    });

    expect(retiro).toMatchObject({
      pricing: "fijo",
      fixedPricePyg: 0,
      zoneIds: [],
    });
  });

  it("una tarifa plana sin precio no se guarda", async () => {
    await expect(
      createShippingMethod({
        name: "Moto",
        kind: "local",
        pricing: "fijo",
        fixedPricePyg: null,
        zoneIds: [],
        allowedPaymentMethods: ["contra_entrega"],
      })
    ).rejects.toBeInstanceOf(AdminShippingMethodError);
  });

  it("un método sin medios de pago no se guarda", async () => {
    await expect(
      createShippingMethod({
        name: "Moto",
        kind: "local",
        pricing: "zona",
        fixedPricePyg: null,
        zoneIds: [],
        allowedPaymentMethods: [],
      })
    ).rejects.toBeInstanceOf(AdminShippingMethodError);
  });

  it("una zona que no existe no se guarda", async () => {
    await expect(
      createShippingMethod({
        name: "Moto",
        kind: "local",
        pricing: "zona",
        fixedPricePyg: null,
        zoneIds: [4242],
        allowedPaymentMethods: ["contra_entrega"],
      })
    ).rejects.toBeInstanceOf(AdminShippingMethodError);
  });

  it("dos métodos no pueden compartir identificador", async () => {
    await createShippingMethod({
      name: "Moto",
      slug: "moto",
      kind: "local",
      pricing: "zona",
      fixedPricePyg: null,
      zoneIds: [],
      allowedPaymentMethods: ["contra_entrega"],
    });

    await expect(
      createShippingMethod({
        name: "Moto de nuevo",
        slug: "moto",
        kind: "local",
        pricing: "zona",
        fixedPricePyg: null,
        zoneIds: [],
        allowedPaymentMethods: ["contra_entrega"],
      })
    ).rejects.toBeInstanceOf(AdminShippingMethodError);
  });

  it("pasar de tarifa plana a precio por zona borra la tarifa vieja", async () => {
    const creado = await createShippingMethod({
      name: "Moto",
      kind: "local",
      pricing: "fijo",
      fixedPricePyg: 15_000,
      zoneIds: [],
      allowedPaymentMethods: ["contra_entrega"],
    });

    await updateShippingMethod({
      methodId: creado.id,
      data: {
        name: "Moto",
        kind: "local",
        pricing: "zona",
        fixedPricePyg: 15_000,
        zoneIds: [],
        allowedPaymentMethods: ["contra_entrega"],
      },
    });

    const [fila] = await getTestDb()
      .select()
      .from(shippingMethods)
      .where(eq(shippingMethods.id, creado.id));
    expect(fila?.fixedPricePyg).toBeNull();
  });

  it("apagar el último método devuelve la tienda al envío implícito", async () => {
    // A diferencia de las zonas, quedarse sin métodos es legítimo: es donde
    // arranca toda tienda clonada y no regala nada.
    await seedZonas();
    const creado = await createShippingMethod({
      name: "Moto",
      kind: "local",
      pricing: "fijo",
      fixedPricePyg: 15_000,
      zoneIds: [],
      allowedPaymentMethods: ["contra_entrega"],
    });

    await setShippingMethodActive({ methodId: creado.id, isActive: false });

    const quote = await quoteShippingMethods("Asunción", 100_000);
    expect(quote.methods).toHaveLength(1);
    expect(quote.methods[0]).toMatchObject({ id: null, shippingPyg: 25_000 });

    // La fila sigue existiendo, sólo apagada: el panel la puede volver a
    // prender sin recargar nada.
    expect(await listAdminShippingMethods()).toHaveLength(1);
  });
});
