import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { customers, orders } from "@/db/schema";
import { lookupOrder } from "@/app/actions/order-lookup";
import { registerCustomer } from "@/domain/customers";
import { publicarFoto } from "@/lib/integraciones";
import { resetRateLimits } from "@/lib/rate-limit";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createOrder } from "../helpers/factories";

const mocks = vi.hoisted(() => ({
  actor: null as null | { customerId: number; phone: string; name: string },
  after: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1" }),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/customer-session", () => ({
  currentCustomer: async () => mocks.actor,
}));
vi.mock("@/lib/cuentas", () => ({
  cuentasClientesHabilitadas: async () => true,
}));
vi.mock("@/lib/integraciones-store", () => ({
  cargarIntegraciones: async () => {},
}));
describe.skipIf(!hasTestDb)("private order recovery", () => {
  beforeEach(async () => {
    await resetTables();
    resetRateLimits();
    publicarFoto({});
    mocks.actor = null;
    mocks.after.mockClear();
  });
  afterAll(async () => {
    publicarFoto({});
    vi.unstubAllGlobals();
    await closeTestDb();
  });
  it("matching number and phone returns the same generic message as an absent order", async () => {
    const id = await createOrder();
    const [order] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, id));
    const found = await lookupOrder({
      orderNumber: order!.orderNumber,
      phone: order!.customerPhone,
    });
    expect(found).toEqual(
      await lookupOrder({ orderNumber: "PY-999999", phone: "0982123456" })
    );
    expect(found).not.toHaveProperty("redirectTo");
    expect(JSON.stringify(found)).not.toContain(order!.accessToken);
  });
  it("an unverified matching account cannot recover the link, while the verified owner can", async () => {
    const c = await registerCustomer({
      phone: "0981123456",
      name: "Test account",
      password: "Customer-password-2026",
    });
    mocks.actor = { customerId: c.id, phone: c.phone, name: c.name };
    const id = await createOrder({ customerPhone: c.phone });
    const [order] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, id));
    expect(
      await lookupOrder({ orderNumber: order!.orderNumber, phone: c.phone })
    ).not.toHaveProperty("redirectTo");
    await getTestDb()
      .update(customers)
      .set({ phoneVerifiedAt: new Date() })
      .where(eq(customers.id, c.id));
    expect(
      await lookupOrder({ orderNumber: order!.orderNumber, phone: c.phone })
    ).toMatchObject({
      ok: true,
      redirectTo: expect.stringContaining(order!.accessToken),
    });
  });
  it("uses the approved recovery template after the response, without falling back to a login template", async () => {
    publicarFoto({
      whatsapp: {
        valores: {
          phoneNumberId: "test-phone-id",
          accessToken: "invented-test-value",
          plantillaLogin: "login_code",
          plantillaRecuperarPedido: "order_recovery",
        },
        ilegibles: [],
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: "test-message" }] }), {
          status: 200,
        })
      );
    vi.stubGlobal("fetch", fetch);
    const id = await createOrder();
    const [order] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, id));
    expect(
      await lookupOrder({
        orderNumber: order!.orderNumber,
        phone: order!.customerPhone,
      })
    ).not.toHaveProperty("redirectTo");
    expect(fetch).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0]![0]();
    const payload = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(payload.template.name).toBe("order_recovery");
    expect(payload.template.components[0].parameters[0].text).toContain(
      order!.accessToken
    );
  });
});
