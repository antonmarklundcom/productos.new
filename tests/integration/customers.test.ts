import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { customers, orders } from "@/db/schema";
import {
  CustomerError,
  authenticateCustomer,
  claimGuestOrder,
  listCustomerOrders,
  listMarketingOptIns,
  registerCustomer,
  updateCustomerProfile,
} from "@/domain/customers";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createOrder } from "../helpers/factories";

/**
 * Cuentas de cliente (PLAN.md FASE 2, PR E) contra MySQL de verdad.
 *
 * Lo que más se prueba acá no es el camino feliz sino los dos que duelen: que
 * el login no delate qué cuentas existen, y que nadie vea los pedidos de otra
 * persona por haber tipeado su número de WhatsApp.
 */

const PASSWORD = "tienda2026segura";

async function nuevaCuenta(
  overrides: Partial<Parameters<typeof registerCustomer>[0]> = {}
) {
  return registerCustomer({
    phone: overrides.phone ?? "0981 123 456",
    password: overrides.password ?? PASSWORD,
    name: overrides.name ?? "Rosa Giménez",
    email: overrides.email,
    marketingOptIn: overrides.marketingOptIn,
  });
}

describe.skipIf(!hasTestDb)("alta de cuenta", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("normaliza el teléfono al formato con el que se guardan los pedidos", async () => {
    const customer = await nuevaCuenta({ phone: "0981 123-456" });
    // La misma forma que `orders.customer_phone`: si no, las dos columnas no
    // se pueden comparar y toda la feature de "mis pedidos" no matchea nunca.
    expect(customer.phone).toBe("+595981123456");
  });

  it("normaliza el email a minúsculas", async () => {
    const customer = await nuevaCuenta({ email: "Rosa@Ejemplo.COM" });
    expect(customer.email).toBe("rosa@ejemplo.com");
  });

  it("rechaza lo que no puede ser un teléfono", async () => {
    // `normalizePhonePY` acepta 8 o 9 dígitos después de sacarle el prefijo,
    // que es la misma regla con la que entra `orders.customer_phone` desde el
    // PR #1. O sea que un número extranjero de 8 dígitos pasa por acá igual
    // que pasa por el checkout — no es algo que esta feature endurezca por su
    // cuenta, y cambiarlo tocaría el camino de compra. Lo que sí se rechaza
    // es lo que no tiene forma de número.
    await expect(nuevaCuenta({ phone: "123" })).rejects.toThrow(CustomerError);
    await expect(nuevaCuenta({ phone: "no-es-un-numero" })).rejects.toThrow(
      CustomerError
    );
    await expect(nuevaCuenta({ phone: "" })).rejects.toThrow(CustomerError);
  });

  it("no deja dos cuentas con el mismo WhatsApp", async () => {
    await nuevaCuenta();
    await expect(nuevaCuenta({ name: "Otra Persona" })).rejects.toThrow(
      CustomerError
    );
  });

  it("no deja dos cuentas con el mismo email", async () => {
    await nuevaCuenta({ email: "rosa@ejemplo.com" });
    await expect(
      nuevaCuenta({ phone: "0982 111 222", email: "ROSA@ejemplo.com" })
    ).rejects.toThrow(CustomerError);
  });

  it("no guarda la contraseña en claro", async () => {
    await nuevaCuenta();
    const [row] = await getTestDb().select().from(customers).limit(1);
    expect(row?.passwordHash).not.toBe(PASSWORD);
    expect(row?.passwordHash?.startsWith("$2")).toBe(true);
  });

  it("sin preguntar por novedades, el consentimiento queda NULL (no false)", async () => {
    await nuevaCuenta();
    const [row] = await getTestDb().select().from(customers).limit(1);
    // Mismo criterio que `orders.marketing_opt_in`: "no se preguntó" y "dijo
    // que no" no son lo mismo, y el consentimiento no se completa después.
    expect(row?.marketingOptIn).toBeNull();
  });

  it("el teléfono nace sin verificar: en esta fase no hay con qué verificarlo", async () => {
    const customer = await nuevaCuenta();
    expect(customer.phoneVerifiedAt).toBeNull();
  });
});

describe.skipIf(!hasTestDb)("login de cliente", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("entra con el teléfono en cualquier formato", async () => {
    await nuevaCuenta();
    expect(await authenticateCustomer("0981 123 456", PASSWORD)).not.toBeNull();
    expect(
      await authenticateCustomer("+595981123456", PASSWORD)
    ).not.toBeNull();
    expect(await authenticateCustomer("981123456", PASSWORD)).not.toBeNull();
  });

  it("entra con el email, en cualquier caja", async () => {
    await nuevaCuenta({ email: "rosa@ejemplo.com" });
    expect(
      await authenticateCustomer("ROSA@Ejemplo.com", PASSWORD)
    ).not.toBeNull();
  });

  it('no distingue "no existe" de "contraseña incorrecta"', async () => {
    await nuevaCuenta();
    // Los tres son el mismo null hacia afuera: si se distinguieran, el login
    // sería un buscador de quién compra en esta tienda.
    expect(await authenticateCustomer("0981 123 456", "otra-cosa")).toBeNull();
    expect(await authenticateCustomer("0999 999 999", PASSWORD)).toBeNull();
    expect(await authenticateCustomer("no-es-nada", PASSWORD)).toBeNull();
  });

  it("una cuenta desactivada no entra", async () => {
    const customer = await nuevaCuenta();
    await getTestDb()
      .update(customers)
      .set({ isActive: false })
      .where(eq(customers.id, customer.id));
    expect(await authenticateCustomer("0981 123 456", PASSWORD)).toBeNull();
  });

  it("una cuenta sin contraseña (la que va a crear el PR F) no entra por acá", async () => {
    const customer = await nuevaCuenta();
    await getTestDb()
      .update(customers)
      .set({ passwordHash: null })
      .where(eq(customers.id, customer.id));

    expect(await authenticateCustomer("0981 123 456", PASSWORD)).toBeNull();
    expect(await authenticateCustomer("0981 123 456", "")).toBeNull();
  });

  it("un login exitoso deja la marca de última entrada", async () => {
    const customer = await nuevaCuenta();
    await authenticateCustomer("0981 123 456", PASSWORD);

    const [row] = await getTestDb()
      .select()
      .from(customers)
      .where(eq(customers.id, customer.id));
    expect(row?.lastLoginAt).toBeInstanceOf(Date);
  });
});

describe.skipIf(!hasTestDb)("mis pedidos", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("muestra los pedidos hechos con la cuenta", async () => {
    const customer = await nuevaCuenta();
    await createOrder({
      customerId: customer.id,
      customerPhone: customer.phone,
    });

    const rows = await listCustomerOrders(customer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.linked).toBe(true);
  });

  /**
   * El test que justifica la columna `phone_verified_at`.
   *
   * El plan pide mostrar "los pedidos viejos que matcheen el teléfono
   * **verificado** de la cuenta". Sin esa condición, registrarse tipeando el
   * WhatsApp de otra persona muestra su historial completo — con nombre,
   * dirección y el token de acceso de cada pedido. En esta fase nada verifica
   * teléfonos, así que ese camino tiene que estar cerrado.
   */
  it("NO muestra los pedidos viejos si el teléfono no está verificado", async () => {
    const customer = await nuevaCuenta();
    await createOrder({ customerPhone: customer.phone }); // de invitada, mismo número

    expect(await listCustomerOrders(customer.id)).toHaveLength(0);
  });

  it("los muestra recién cuando el teléfono queda verificado (PR F)", async () => {
    const customer = await nuevaCuenta();
    await createOrder({ customerPhone: customer.phone });

    await getTestDb()
      .update(customers)
      .set({ phoneVerifiedAt: new Date() })
      .where(eq(customers.id, customer.id));

    const rows = await listCustomerOrders(customer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.linked).toBe(false);
  });

  it("nunca muestra los pedidos de otro número, ni con el teléfono verificado", async () => {
    const customer = await nuevaCuenta();
    await createOrder({ customerPhone: "+595982999888" });

    await getTestDb()
      .update(customers)
      .set({ phoneVerifiedAt: new Date() })
      .where(eq(customers.id, customer.id));

    expect(await listCustomerOrders(customer.id)).toHaveLength(0);
  });
});

describe.skipIf(!hasTestDb)("adoptar un pedido de invitada", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("ata el pedido propio recién hecho", async () => {
    const customer = await nuevaCuenta();
    const orderId = await createOrder({ customerPhone: customer.phone });

    const [before] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(
      await claimGuestOrder(
        customer.id,
        before!.orderNumber,
        before!.accessToken
      )
    ).toBe(true);

    const [after] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(after?.customerId).toBe(customer.id);
  });

  it("NO ata el pedido de otro número aunque se sepa el nro. de pedido", async () => {
    const customer = await nuevaCuenta();
    const orderId = await createOrder({ customerPhone: "+595982999888" });

    const [row] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(
      await claimGuestOrder(customer.id, row!.orderNumber, "invalid-token")
    ).toBe(false);

    const [after] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(after?.customerId).toBeNull();
  });

  it("NO le roba a otra cuenta un pedido que ya tiene dueño", async () => {
    const dueña = await nuevaCuenta();
    const otra = await nuevaCuenta({
      phone: "0982 999 888",
      name: "Otra Persona",
    });

    // Mismo teléfono que la primera cuenta, pero ya atado a ella.
    const orderId = await createOrder({
      customerPhone: dueña.phone,
      customerId: dueña.id,
    });
    const [row] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));

    expect(
      await claimGuestOrder(otra.id, row!.orderNumber, row!.accessToken)
    ).toBe(false);

    const [after] = await getTestDb()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(after?.customerId).toBe(dueña.id);
  });
});

describe.skipIf(!hasTestDb)("la lista de novedades", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("sólo trae a quien dijo que sí", async () => {
    await nuevaCuenta({ phone: "0981 111 111", marketingOptIn: true });
    await nuevaCuenta({ phone: "0982 222 222", marketingOptIn: false });
    await nuevaCuenta({ phone: "0983 333 333" }); // no se le preguntó

    const list = await listMarketingOptIns();
    expect(list).toHaveLength(1);
    expect(list[0]?.phone).toBe("+595981111111");
  });

  it("deja afuera a las cuentas desactivadas", async () => {
    const customer = await nuevaCuenta({ marketingOptIn: true });
    await getTestDb()
      .update(customers)
      .set({ isActive: false })
      .where(eq(customers.id, customer.id));

    expect(await listMarketingOptIns()).toHaveLength(0);
  });

  it("respeta que alguien se dé de baja después", async () => {
    const customer = await nuevaCuenta({ marketingOptIn: true });
    expect(await listMarketingOptIns()).toHaveLength(1);

    await updateCustomerProfile(customer.id, {
      name: "Rosa Giménez",
      marketingOptIn: false,
    });
    expect(await listMarketingOptIns()).toHaveLength(0);
  });
});

describe.skipIf(!hasTestDb)("mis datos", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("no deja quedarse con el email de otra cuenta", async () => {
    await nuevaCuenta({ phone: "0981 111 111", email: "ocupado@ejemplo.com" });
    const otra = await nuevaCuenta({ phone: "0982 222 222" });

    await expect(
      updateCustomerProfile(otra.id, {
        name: "Otra Persona",
        email: "ocupado@ejemplo.com",
        marketingOptIn: false,
      })
    ).rejects.toThrow(CustomerError);
  });

  it("el teléfono no se puede cambiar desde el perfil", async () => {
    const customer = await nuevaCuenta();
    await updateCustomerProfile(customer.id, {
      name: "Rosa G.",
      marketingOptIn: true,
    });

    const [row] = await getTestDb()
      .select()
      .from(customers)
      .where(eq(customers.id, customer.id));
    // Es la llave de la cuenta y lo que matchea los pedidos: cambiarlo pide
    // una verificación que todavía no existe.
    expect(row?.phone).toBe("+595981123456");
    expect(row?.name).toBe("Rosa G.");
  });
});
