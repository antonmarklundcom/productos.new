import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { customers, loginTokens } from "@/db/schema";
import { registerCustomer } from "@/domain/customers";
import {
  consumeLoginToken,
  hashLoginCode,
  issueLoginToken,
  LOGIN_TOKEN_TTL_MS,
} from "@/domain/login-tokens";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createOrder } from "../helpers/factories";
import { listCustomerOrders } from "@/domain/customers";

/**
 * Códigos de un solo uso (PLAN.md FASE 2, PR F.1), contra MySQL.
 *
 * Del otro lado de cada código hay una sesión abierta, así que lo que se prueba
 * acá es sobre todo lo que **no** tiene que pasar: que no se pueda usar dos
 * veces, que no sirva después de vencer, que pedir uno nuevo mate al anterior,
 * y que el código nunca quede escrito en la tabla.
 */

const PASSWORD = "tienda2026segura";

async function unaCuenta(phone = "0981 123 456") {
  return registerCustomer({ phone, password: PASSWORD, name: "Rosa Giménez" });
}

describe.skipIf(!hasTestDb)("emisión", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("guarda el hash y NUNCA el código", async () => {
    const customer = await unaCuenta();
    const { code } = await issueLoginToken(customer.id, "consola");

    const [row] = await getTestDb().select().from(loginTokens);
    expect(row?.tokenHash).toBe(hashLoginCode(customer.id, code));
    // Lo importante: un dump de la base no abre la sesión de nadie.
    expect(JSON.stringify(row)).not.toContain(code);
  });

  it("vence a los 10 minutos", async () => {
    const customer = await unaCuenta();
    const { expiresAt } = await issueLoginToken(customer.id, "consola");

    const margen = Math.abs(
      expiresAt.getTime() - (Date.now() + LOGIN_TOKEN_TTL_MS)
    );
    expect(margen).toBeLessThan(5_000);
  });

  it("pedir uno nuevo invalida el anterior", async () => {
    const customer = await unaCuenta();
    const primero = await issueLoginToken(customer.id, "consola");
    await issueLoginToken(customer.id, "consola");

    // Si no se invalidara, cada pedido sumaría otro código vivo y la ventana
    // de adivinación crecería con cada intento.
    expect(await consumeLoginToken(customer.phone, primero.code)).toBeNull();
  });

  it("el segundo código sí sirve", async () => {
    const customer = await unaCuenta();
    await issueLoginToken(customer.id, "consola");
    const segundo = await issueLoginToken(customer.id, "consola");

    expect(await consumeLoginToken(customer.phone, segundo.code)).toMatchObject(
      { customerId: customer.id }
    );
  });
});

describe.skipIf(!hasTestDb)("canje", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("un código válido abre la sesión una vez", async () => {
    const customer = await unaCuenta();
    const { code } = await issueLoginToken(customer.id, "consola");

    expect(await consumeLoginToken(customer.phone, code)).toMatchObject({
      customerId: customer.id,
    });
    // Y una sola: la segunda vez no sirve.
    expect(await consumeLoginToken(customer.phone, code)).toBeNull();
  });

  it("un código vencido no sirve", async () => {
    const customer = await unaCuenta();
    const { code } = await issueLoginToken(customer.id, "consola");

    await getTestDb()
      .update(loginTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(loginTokens.customerId, customer.id));

    expect(await consumeLoginToken(customer.phone, code)).toBeNull();
  });

  it("un código que no existe no sirve, y no explota", async () => {
    expect(await consumeLoginToken("+595981123456", "000000")).toBeNull();
    expect(await consumeLoginToken("+595981123456", "abcdef")).toBeNull();
    expect(await consumeLoginToken("+595981123456", "")).toBeNull();
    expect(await consumeLoginToken("+595981123456", "12345")).toBeNull();
    expect(await consumeLoginToken("+595981123456", "1234567")).toBeNull();
  });

  it("una cuenta desactivada no entra ni con código válido", async () => {
    const customer = await unaCuenta();
    const { code } = await issueLoginToken(customer.id, "consola");

    await getTestDb()
      .update(customers)
      .set({ isActive: false })
      .where(eq(customers.id, customer.id));

    expect(await consumeLoginToken(customer.phone, code)).toBeNull();
  });

  it("dos canjes simultáneos abren una sola sesión", async () => {
    const customer = await unaCuenta();
    const { code } = await issueLoginToken(customer.id, "consola");

    // Dos pestañas con el mismo código. El UPDATE condicional es lo que hace
    // que sólo una toque una fila.
    const [a, b] = await Promise.all([
      consumeLoginToken(customer.phone, code),
      consumeLoginToken(customer.phone, code),
    ]);

    const abiertas = [a, b].filter((result) => result !== null);
    expect(abiertas).toHaveLength(1);
  });
});

/**
 * El efecto que cierra el hueco que el PR E dejó abierto a propósito: entrar
 * con un código que llegó al teléfono **prueba** que ese teléfono es suyo.
 */
describe.skipIf(!hasTestDb)("entrar con código verifica el teléfono", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("escribe phone_verified_at", async () => {
    const customer = await unaCuenta();
    expect(customer.phoneVerifiedAt).toBeNull();

    const { code } = await issueLoginToken(customer.id, "consola");
    await consumeLoginToken(customer.phone, code);

    const [row] = await getTestDb()
      .select()
      .from(customers)
      .where(eq(customers.id, customer.id));
    expect(row?.phoneVerifiedAt).toBeInstanceOf(Date);
  });

  it("y recién ahí aparecen los pedidos que hizo como invitada", async () => {
    const customer = await unaCuenta();
    await createOrder({ customerPhone: customer.phone });

    // Antes de verificar: no se muestran, porque cualquiera pudo haber tipeado
    // ese número al registrarse (PR E).
    expect(await listCustomerOrders(customer.id)).toHaveLength(0);

    const { code } = await issueLoginToken(customer.id, "consola");
    await consumeLoginToken(customer.phone, code);

    // Después: el teléfono está probado y el historial es suyo.
    const rows = await listCustomerOrders(customer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.linked).toBe(false);
  });
});

/**
 * Dos defensas encontradas en la revisión de seguridad del cierre de la FASE 2.
 */
describe.skipIf(!hasTestDb)("robustez de la emisión", () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("un hash ya usado en el pasado no rompe la emisión", async () => {
    const customer = await unaCuenta();

    // `token_hash` es UNIQUE sobre toda la tabla y las filas no se borran, así
    // que un código nuevo puede chocar contra uno histórico ya consumido. Sin
    // el reintento, la persona no recibe nada y no hay nada que lo explique.
    // Se simula ocupando el hash de un código conocido.
    const ocupado = "000000";
    await getTestDb()
      .insert(loginTokens)
      .values({
        customerId: customer.id,
        tokenHash: hashLoginCode(customer.id, ocupado),
        channel: "consola",
        expiresAt: new Date(Date.now() - 60_000),
        consumedAt: new Date(),
      });

    // Emitir muchas veces: si alguna sale con el hash ocupado, el reintento
    // tiene que taparlo en vez de tirar.
    for (let i = 0; i < 30; i += 1) {
      const { code } = await issueLoginToken(customer.id, "consola");
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("el código viejo ya consumido no revive al emitir uno nuevo", async () => {
    const customer = await unaCuenta();
    const primero = await issueLoginToken(customer.id, "consola");
    await consumeLoginToken(customer.phone, primero.code);

    await issueLoginToken(customer.id, "consola");

    expect(await consumeLoginToken(customer.phone, primero.code)).toBeNull();
  });
});
