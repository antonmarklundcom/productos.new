import { seedPaymentReadiness } from "../helpers/db";
import { desc, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { orderEvents, shippingZones } from "@/db/schema";
import { createOrder, type CreateOrderInput } from "@/domain/create-order";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createVariant } from "../helpers/factories";

/**
 * El aviso "confirmado" a la compradora, disparado desde `createOrder()`
 * mismo (ARCH.md §5.2.1) — no desde `submitCheckout`, para que valga para
 * TODO pedido nuevo sin importar por qué ruta se creó.
 */

function mockFetchOk() {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), {
        status: 200,
      })
  );
}

const CLOUD_ENV = {
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: "123456",
  WHATSAPP_CLOUD_ACCESS_TOKEN: "token-de-prueba",
  WHATSAPP_CLOUD_TEMPLATE_NAME: "login_otp",
};

async function seedZone() {
  await getTestDb()
    .insert(shippingZones)
    .values({
      slug: "asuncion",
      name: "Asunción",
      cities: ["Asunción"],
      pricePyg: 25000,
      position: 1,
    });
}

function input(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    items: [],
    customerName: "Rosa Giménez",
    customerPhone: "0981 555 555",
    docType: "NINGUNO",
    isConsumidorFinal: true,
    shipCity: "Asunción",
    shipAddress: "Av. Mcal. López 1234",
    paymentMethod: "transferencia",
    ...overrides,
  };
}

describe.skipIf(!hasTestDb)(
  "createOrder → aviso 'confirmado' a la compradora",
  () => {
    beforeEach(async () => {
      await resetTables();
      await seedPaymentReadiness();
      await seedZone();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      for (const [key, value] of Object.entries(CLOUD_ENV))
        vi.stubEnv(key, value);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    afterAll(closeTestDb);

    it("con la plantilla configurada, manda el aviso apenas se crea el pedido", async () => {
      vi.stubEnv(
        "WHATSAPP_CLOUD_TEMPLATE_CLIENTE_CONFIRMADO",
        "cliente_confirmado"
      );
      const fetchMock = mockFetchOk();
      vi.stubGlobal("fetch", fetchMock);

      const variantId = await createVariant({ onHand: 5, pricePyg: 100000 });
      const order = await createOrder(
        input({ items: [{ variantId, qty: 1 }] })
      );

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), {
        timeout: 2000,
        interval: 20,
      });

      const call = fetchMock.mock.calls[0];
      if (!call) throw new Error("fetch no se llamó");
      const [, init] = call;
      const body = JSON.parse(init?.body as string);
      expect(body.to).toBe("595981555555");
      expect(body.template.name).toBe("cliente_confirmado");
      expect(body.template.components[0].parameters[0].text).toContain(
        order.orderNumber
      );

      // El evento se escribe después de que `fetch` responde, en el mismo
      // disparo sin await: esperarlo igual que al fetch, no leerlo una vez.
      await vi.waitFor(
        async () => {
          const rows = await getTestDb()
            .select()
            .from(orderEvents)
            .where(eq(orderEvents.orderId, order.orderId))
            .orderBy(desc(orderEvents.id));
          expect(
            rows.some((r) => r.reason === "aviso_cliente_confirmado")
          ).toBe(true);
        },
        { timeout: 2000, interval: 20 }
      );
    });

    it("sin la plantilla, crea el pedido igual y no manda nada", async () => {
      const fetchMock = mockFetchOk();
      vi.stubGlobal("fetch", fetchMock);

      const variantId = await createVariant({ onHand: 5, pricePyg: 100000 });
      await createOrder(input({ items: [{ variantId, qty: 1 }] }));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
);
