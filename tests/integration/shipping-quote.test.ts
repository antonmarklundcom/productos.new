import { seedPaymentReadiness } from "../helpers/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  orders,
  shippingZones,
  stockReservations,
  variants,
} from "@/db/schema";
import { createOrder } from "@/domain/create-order";
import { computeOrderTotals } from "@/domain/order-totals";
import { getAvailability } from "@/domain/stock";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant, getOnHand } from "../helpers/factories";

/**
 * Cotización de envío antes de crear el pedido.
 *
 * Lo que hay que probar no es que la cuenta dé bien —eso ya lo prueban los
 * tests de `createOrder`— sino las dos propiedades que hacen que la
 * cotización no sea una segunda fuente de verdad:
 *
 * 1. Cotizar **no escribe nada**: ni pedido, ni reserva, ni stock movido.
 * 2. Lo cotizado y lo cobrado **coinciden hasta el guaraní**, porque salen de
 *    la misma función. El test compara los dos números, que es la forma de
 *    que la próxima persona que meta un descuento en un solo lado se entere.
 */

describe.skipIf(!hasTestDb)("cotización de envío", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
    await getTestDb()
      .insert(shippingZones)
      .values([
        {
          slug: "asuncion",
          name: "Asunción",
          cities: ["Asunción", "Fernando de la Mora"],
          pricePyg: 25_000,
          freeThresholdPyg: 500_000,
          position: 1,
        },
        {
          slug: "interior",
          name: "Interior",
          cities: ["Encarnación"],
          pricePyg: 60_000,
          freeThresholdPyg: null,
          position: 2,
        },
      ]);
  });
  afterAll(closeTestDb);

  it("no crea el pedido ni toca el stock", async () => {
    const db = getTestDb();
    const variantId = await createVariant({ onHand: 4, pricePyg: 110_000 });

    const quote = await computeOrderTotals([{ variantId, qty: 2 }], "Asunción");

    expect(quote.totalPyg).toBe(245_000);
    expect(await db.select().from(orders)).toHaveLength(0);
    expect(await db.select().from(stockReservations)).toHaveLength(0);
    expect(await getOnHand(variantId)).toBe(4);
    // Lo importante: la unidad sigue disponible para todo el mundo. Una
    // cotización que reservara sería una forma silenciosa de agotar la
    // vidriera.
    expect(await getAvailability(variantId)).toBe(4);
  });

  it("lo cotizado es exactamente lo que después se cobra", async () => {
    const variantId = await createVariant({ onHand: 4, pricePyg: 110_000 });
    const items = [{ variantId, qty: 2 }];

    const quote = await computeOrderTotals(items, "Asunción");
    const order = await createOrder({
      items,
      customerName: "Rosa Giménez",
      customerPhone: "0981 123 456",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "transferencia",
    });

    expect(order.subtotalPyg).toBe(quote.subtotalPyg);
    expect(order.shippingPyg).toBe(quote.shippingPyg);
    expect(order.totalPyg).toBe(quote.totalPyg);
    expect(order.iva10Pyg).toBe(quote.iva10Pyg);
    expect(order.iva5Pyg).toBe(quote.iva5Pyg);

    const [row] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, order.orderId));
    expect(row?.totalPyg).toBe(quote.totalPyg);
  });

  it("manda el pedido, no la cotización: si el precio cambia en el medio, se cobra el nuevo", async () => {
    const variantId = await createVariant({ onHand: 4, pricePyg: 110_000 });
    const items = [{ variantId, qty: 1 }];

    const quote = await computeOrderTotals(items, "Asunción");
    expect(quote.totalPyg).toBe(135_000);

    // El comercio sube el precio mientras la compradora completa el formulario.
    await getTestDb()
      .update(variants)
      .set({ pricePyg: 150_000 })
      .where(eq(variants.id, variantId));

    const order = await createOrder({
      items,
      customerName: "Rosa Giménez",
      customerPhone: "0981 123 456",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "transferencia",
    });

    // La cotización no viaja de vuelta ni se compara con nada: el pedido se
    // arma con lo que dice la DB en ese momento (ARCH.md §1 regla 1).
    expect(order.totalPyg).toBe(175_000);
  });

  it("una tienda sin zonas configuradas no cobra envío, y no lo confunde con la tarifa más cara", async () => {
    // Es el estado en el que sale toda tienda recién clonada del template.
    // `sin_zonas` existe para que el checkout no diga "Gratis" y "te cobramos
    // la tarifa más alta" en la misma pantalla.
    await getTestDb().delete(shippingZones);
    const variantId = await createVariant({ onHand: 4, pricePyg: 100_000 });

    const quote = await computeOrderTotals([{ variantId, qty: 1 }], "Asunción");

    expect(quote.shipping.match).toBe("sin_zonas");
    expect(quote.shippingPyg).toBe(0);
    expect(quote.totalPyg).toBe(100_000);
  });

  it("una ciudad que no está en ninguna zona cotiza la tarifa más cara, y lo dice", async () => {
    const variantId = await createVariant({ onHand: 4, pricePyg: 100_000 });

    const quote = await computeOrderTotals(
      [{ variantId, qty: 1 }],
      "Pedro Juan Caballero"
    );

    expect(quote.shipping.match).toBe("mas_cara");
    expect(quote.shippingPyg).toBe(60_000);
  });

  it("pasado el umbral de la zona, el envío cotiza gratis", async () => {
    const variantId = await createVariant({ onHand: 10, pricePyg: 250_000 });

    const quote = await computeOrderTotals([{ variantId, qty: 2 }], "Asunción");

    expect(quote.shipping.isFree).toBe(true);
    expect(quote.shippingPyg).toBe(0);
    expect(quote.totalPyg).toBe(500_000);
  });
});

/**
 * El aviso de "el total cambió".
 *
 * La cotización es sólo para mostrar, pero cobrar en silencio algo distinto
 * de lo que ella vio es la forma de perder la confianza que esta pantalla
 * existe para dar. El navegador manda el total que tenía en pantalla; el
 * servidor lo **compara** con el que acaba de calcular y, si no coinciden, no
 * escribe nada y lo dice. Ninguno de los dos números se cobra por venir del
 * navegador: se cobra el de la DB.
 */
describe.skipIf(!hasTestDb)(
  "el total cambió entre la cotización y el pedido",
  () => {
    beforeEach(async () => {
      await resetTables();
      await seedPaymentReadiness();
      await getTestDb()
        .insert(shippingZones)
        .values({
          slug: "asuncion",
          name: "Asunción",
          cities: ["Asunción"],
          pricePyg: 25_000,
          freeThresholdPyg: 500_000,
          position: 1,
        });
    });

    function pedido(variantId: number, expectedTotalPyg?: number) {
      return {
        items: [{ variantId, qty: 1 }],
        customerName: "Rosa Giménez",
        customerPhone: "0981 123 456",
        docType: "NINGUNO" as const,
        isConsumidorFinal: true,
        shipCity: "Asunción",
        shipAddress: "Av. Mcal. López 1234",
        paymentMethod: "transferencia" as const,
        expectedTotalPyg,
      };
    }

    it("una rebaja que cruza el umbral SUBE el total, y se avisa en vez de cobrarlo", async () => {
      // El caso que motivó todo esto: el umbral hace que el total no sea
      // monótono en el precio. Producto a ₲500.000 con envío gratis desde
      // ₲500.000 → total ₲500.000. El comercio lo baja a ₲490.000, cae abajo
      // del umbral y aparece el flete: ₲515.000. Más barato el producto, más
      // caro el total.
      const variantId = await createVariant({ onHand: 5, pricePyg: 500_000 });
      const quote = await computeOrderTotals(
        [{ variantId, qty: 1 }],
        "Asunción"
      );
      expect(quote.totalPyg).toBe(500_000);
      expect(quote.shipping.isFree).toBe(true);

      await getTestDb()
        .update(variants)
        .set({ pricePyg: 490_000 })
        .where(eq(variants.id, variantId));

      await expect(
        createOrder(pedido(variantId, quote.totalPyg))
      ).rejects.toMatchObject({
        name: "TotalChangedError",
        before: 500_000,
        after: 515_000,
      });
    });

    it("el pedido rechazado no deja nada escrito: ni pedido, ni reserva, ni número consumido", async () => {
      const db = getTestDb();
      const variantId = await createVariant({ onHand: 5, pricePyg: 500_000 });

      await expect(createOrder(pedido(variantId, 999_999))).rejects.toThrow();

      expect(await db.select().from(orders)).toHaveLength(0);
      expect(await db.select().from(stockReservations)).toHaveLength(0);
      expect(await getAvailability(variantId)).toBe(5);

      // El contador tampoco se gastó: el pedido siguiente es el PY-000001.
      const ok = await createOrder(pedido(variantId));
      expect(ok.orderNumber).toBe("PY-000001");
    });

    it("confirmando el total nuevo, el pedido entra y se cobra el de la DB", async () => {
      const variantId = await createVariant({ onHand: 5, pricePyg: 490_000 });

      const order = await createOrder(pedido(variantId, 515_000));

      expect(order.totalPyg).toBe(515_000);
      expect(order.shippingPyg).toBe(25_000);
    });

    it("sin total en pantalla no hay nada que comparar y el pedido sigue de largo", async () => {
      // No llegó a poner la ciudad, así que nunca vio un total. El pedido se
      // crea igual, como antes de que existiera la cotización.
      const variantId = await createVariant({ onHand: 5, pricePyg: 490_000 });

      const order = await createOrder(pedido(variantId, undefined));

      expect(order.totalPyg).toBe(515_000);
    });

    it("el número del navegador nunca se cobra, ni cuando coincide por casualidad", async () => {
      // Manda un total correcto para un precio viejo; la DB manda igual.
      const variantId = await createVariant({ onHand: 5, pricePyg: 300_000 });

      const order = await createOrder(pedido(variantId, 325_000));

      expect(order.totalPyg).toBe(325_000);
      const [row] = await getTestDb()
        .select()
        .from(orders)
        .where(eq(orders.id, order.orderId));
      expect(row?.totalPyg).toBe(325_000);
    });
  }
);
