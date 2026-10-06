import { seedPaymentReadiness } from "../helpers/db";
import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  orderEvents,
  orderItems,
  orders,
  paymentEvents,
  payments,
  stockReservations,
} from "../../src/db/schema";
import { createOrder as placeOrder } from "../../src/domain/create-order";
import { expireOverdueOrders } from "../../src/domain/maintenance";
import { findUnmatchedPayments } from "../../src/domain/payment-recovery";
import { processPagoparWebhook } from "../../src/domain/pagopar/webhook";
import type { PagoparWebhookEvent } from "../../src/domain/pagopar/protocol";
import { InsufficientStockError, reserveStock } from "../../src/domain/stock";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import {
  createOrder as insertBareOrder,
  createVariant,
  getOnHand,
  getStatus,
} from "../helpers/factories";

/**
 * Concurrencia real contra MySQL (PLAN.md 4.9).
 *
 * Nada de esto se puede probar en secuencia: los bugs que busca aparecen
 * justamente cuando dos transacciones están abiertas **al mismo tiempo** sobre
 * las mismas filas. Cada test lanza sus operaciones con `Promise.all`, cada una
 * en su propia conexión del pool, y afirma sobre el resultado agregado — nunca
 * sobre "quién ganó", que es lo único que legítimamente puede variar.
 *
 * La forma de todos: **exactamente uno gana, el otro pierde limpio, y el stock
 * físico queda como corresponde.** Si en vez de perder limpio el perdedor
 * explota con un error de MySQL, eso es un bug del código, no del test.
 */

const HOUR = 3_600_000;

describe.skipIf(!hasTestDb)("concurrencia", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  // ---------------------------------------------------------------------------
  // Andamiaje
  // ---------------------------------------------------------------------------

  function checkout(variantId: number, qty: number, nombre: string) {
    return placeOrder({
      items: [{ variantId, qty }],
      customerName: nombre,
      customerPhone: "0981123456",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "tarjeta",
    });
  }

  /** Pedido de tarjeta con su fila en `payments`, listo para recibir el aviso. */
  async function pedidoConPagopar(options: {
    variantId: number;
    qty: number;
    totalPyg: number;
    reservedUntil: Date;
    reservationExpiresAt: Date;
  }): Promise<{ orderId: number; hashPedido: string }> {
    const db = getTestDb();
    const orderNumber = `PY-T${randomBytes(4).toString("hex").toUpperCase()}`;

    await db.insert(orders).values({
      orderNumber,
      accessToken: randomBytes(32).toString("hex"),
      status: "pendiente_pago",
      customerName: "Ana López",
      customerPhone: "+595981123456",
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "tarjeta",
      subtotalPyg: options.totalPyg,
      totalPyg: options.totalPyg,
      reservedUntil: options.reservedUntil,
    });

    const orderId = (
      await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
    )[0]?.id;
    if (!orderId) throw new Error("no pude crear el pedido");

    await db.insert(orderEvents).values({
      orderId,
      fromStatus: null,
      toStatus: "pendiente_pago",
      actor: "buyer",
      reason: "pedido creado (tarjeta)",
    });

    await db.insert(orderItems).values({
      orderId,
      variantId: options.variantId,
      nameSnapshot: "Yerba — Único",
      skuSnapshot: `SKU-${orderNumber}`,
      unitPricePyg: options.totalPyg / options.qty,
      qty: options.qty,
      ivaRate: 10,
      lineTotalPyg: options.totalPyg,
    });

    await db.insert(stockReservations).values({
      variantId: options.variantId,
      orderId,
      qty: options.qty,
      expiresAt: options.reservationExpiresAt,
      state: "held",
    });

    const hashPedido = randomBytes(32).toString("hex");
    await db.insert(payments).values({
      orderId,
      provider: "pagopar",
      providerRef: hashPedido,
      amountPyg: options.totalPyg,
      status: "pending",
    });

    return { orderId, hashPedido };
  }

  function aviso(hashPedido: string, montoPyg: number): PagoparWebhookEvent {
    return {
      hashPedido,
      pagado: true,
      montoPyg,
      raw: { hash_pedido: hashPedido, pagado: true, monto: String(montoPyg) },
    };
  }

  // ---------------------------------------------------------------------------
  // 1. Dos checkouts peleando por la última unidad
  // ---------------------------------------------------------------------------

  it("dos checkouts por la última unidad: uno cobra, el otro pierde limpio", async () => {
    const variantId = await createVariant({ onHand: 1, pricePyg: 100_000 });

    const results = await Promise.allSettled([
      checkout(variantId, 1, "Ana"),
      checkout(variantId, 1, "Beto"),
    ]);

    const ganadores = results.filter((r) => r.status === "fulfilled");
    const perdedores = results.filter((r) => r.status === "rejected");

    expect(ganadores).toHaveLength(1);
    expect(perdedores).toHaveLength(1);

    // El perdedor recibe un error de dominio, no un ER_LOCK_DEADLOCK: la
    // diferencia entre "no queda stock" y "probá de nuevo" en la pantalla del
    // comprador.
    const motivo = (perdedores[0] as PromiseRejectedResult).reason;
    expect(motivo).toBeInstanceOf(Error);
    expect(["InsufficientStockError", "CheckoutError"]).toContain(
      (motivo as Error).name
    );

    // Y una sola reserva viva sobre la variante.
    const held = await getTestDb()
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.variantId, variantId));
    expect(held.filter((row) => row.state === "held")).toHaveLength(1);
    expect(await getOnHand(variantId)).toBe(1);
  });

  it("diez checkouts sobre tres unidades reservan exactamente tres", async () => {
    const variantId = await createVariant({ onHand: 3, pricePyg: 100_000 });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        checkout(variantId, 1, `Comprador ${i}`)
      )
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);

    const reservado = (
      await getTestDb()
        .select()
        .from(stockReservations)
        .where(eq(stockReservations.variantId, variantId))
    )
      .filter((row) => row.state === "held")
      .reduce((total, row) => total + row.qty, 0);

    expect(reservado).toBe(3);
  });

  it("dos carritos con las mismas dos variantes en orden opuesto no se deadlockean", async () => {
    // El deadlock de manual: A toma la variante 1 y pide la 2, B toma la 2 y
    // pide la 1. `reserveStock` ordena por `variant_id` justamente para que no
    // pase; esto es lo que fija esa decisión.
    const primera = await createVariant({ onHand: 5, pricePyg: 50_000 });
    const segunda = await createVariant({ onHand: 5, pricePyg: 50_000 });

    const carrito = (
      items: Array<{ variantId: number; qty: number }>,
      nombre: string
    ) =>
      placeOrder({
        items,
        customerName: nombre,
        customerPhone: "0981123456",
        docType: "NINGUNO",
        isConsumidorFinal: true,
        shipCity: "Asunción",
        shipAddress: "Av. Mcal. López 1234",
        paymentMethod: "tarjeta",
      });

    const results = await Promise.allSettled([
      carrito(
        [
          { variantId: primera, qty: 1 },
          { variantId: segunda, qty: 1 },
        ],
        "Ana"
      ),
      carrito(
        [
          { variantId: segunda, qty: 1 },
          { variantId: primera, qty: 1 },
        ],
        "Beto"
      ),
    ]);

    // Los dos entran: hay stock de sobra. Lo que se prueba es que ninguno
    // muere con ER_LOCK_DEADLOCK.
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  // ---------------------------------------------------------------------------
  // 2. reserveStock contra su propio vencimiento
  // ---------------------------------------------------------------------------

  it("una reserva vencida deja pasar a la siguiente sin duplicar el stock", async () => {
    // Última unidad, reservada por un pedido cuya reserva ya venció. La
    // disponibilidad se calcula en vivo, así que el nuevo comprador tiene que
    // poder llevársela aunque el cron todavía no haya pasado.
    const variantId = await createVariant({ onHand: 1, pricePyg: 100_000 });
    const viejo = await placeOrder({
      items: [{ variantId, qty: 1 }],
      customerName: "Ana",
      customerPhone: "0981123456",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "tarjeta",
    });

    await getTestDb()
      .update(stockReservations)
      .set({ expiresAt: new Date(Date.now() - HOUR) })
      .where(eq(stockReservations.orderId, viejo.orderId));

    // Ahora dos cosas al mismo tiempo: el cron venciendo el pedido viejo y un
    // comprador nuevo llevándose la unidad que quedó libre.
    const [vencidos, nuevo] = await Promise.all([
      expireOverdueOrders(new Date(Date.now() + HOUR)),
      checkout(variantId, 1, "Beto"),
    ]);

    expect(vencidos.expired).toContain(viejo.orderId);
    expect(await getStatus(viejo.orderId)).toBe("vencido");
    expect(await getStatus(nuevo.orderId)).toBe("pendiente_pago");

    // Una sola reserva viva: la del comprador nuevo. Nadie duplicó la unidad.
    const vivas = (
      await getTestDb()
        .select()
        .from(stockReservations)
        .where(eq(stockReservations.variantId, variantId))
    ).filter((row) => row.state === "held" && row.expiresAt > new Date());
    expect(vivas).toHaveLength(1);
    expect(vivas[0]?.orderId).toBe(nuevo.orderId);
  });

  it("dos reservas simultáneas sobre una reserva que acaba de vencer: sólo una entra", async () => {
    const variantId = await createVariant({ onHand: 1, pricePyg: 100_000 });
    const viejoId = (await checkout(variantId, 1, "Ana")).orderId;

    await getTestDb()
      .update(stockReservations)
      .set({ expiresAt: new Date(Date.now() - HOUR) })
      .where(eq(stockReservations.orderId, viejoId));

    const results = await Promise.allSettled([
      checkout(variantId, 1, "Beto"),
      checkout(variantId, 1, "Carla"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await getOnHand(variantId)).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 3. El webhook contra el cron
  // ---------------------------------------------------------------------------

  it("webhook y cron a la vez: o cobra o vence, pero el pago queda registrado", async () => {
    const variantId = await createVariant({ onHand: 5, pricePyg: 75_000 });
    const { orderId, hashPedido } = await pedidoConPagopar({
      variantId,
      qty: 2,
      totalPyg: 150_000,
      // Ya pasado: el cron lo va a querer vencer en esta misma corrida.
      reservedUntil: new Date(Date.now() - 1_000),
      reservationExpiresAt: new Date(Date.now() + HOUR),
    });

    await Promise.all([
      processPagoparWebhook(aviso(hashPedido, 150_000)),
      expireOverdueOrders(new Date()),
    ]);

    const status = await getStatus(orderId);
    const onHand = await getOnHand(variantId);

    // Las dos únicas resoluciones aceptables. Cuál gana depende del scheduler y
    // no es asunto del test; lo que no puede pasar es un tercer resultado.
    expect(["pagado", "vencido"]).toContain(status);

    if (status === "pagado") {
      // Cobró: descontó exactamente lo del pedido, ni más ni menos.
      expect(onHand).toBe(3);
      expect(await findUnmatchedPayments()).toEqual([]);
    } else {
      // Venció primero y el pago no pudo recuperarse en esa pasada: el stock
      // sigue entero y la plata aparece en la lista del dueño.
      expect(onHand).toBe(5);
      expect(
        (await findUnmatchedPayments()).map((row) => row.orderId)
      ).toContain(orderId);
    }

    // Pase lo que pase: el pago quedó registrado. Es la única regla que no
    // admite "depende de quién ganó".
    const pago = (
      await getTestDb()
        .select()
        .from(payments)
        .where(eq(payments.orderId, orderId))
    )[0];
    expect(pago?.status).toBe("paid");
  });

  // ---------------------------------------------------------------------------
  // 4. Dos avisos idénticos al mismo tiempo (el INSERT IGNORE bajo contención)
  // ---------------------------------------------------------------------------

  it("dos avisos idénticos simultáneos: uno aplica, el otro es repetido", async () => {
    const variantId = await createVariant({ onHand: 5, pricePyg: 75_000 });
    const { orderId, hashPedido } = await pedidoConPagopar({
      variantId,
      qty: 2,
      totalPyg: 150_000,
      reservedUntil: new Date(Date.now() + HOUR),
      reservationExpiresAt: new Date(Date.now() + HOUR),
    });

    // El caso que una llamada secuencial no prueba: las dos transacciones
    // abiertas a la vez sobre la misma clave única de payment_events. La
    // segunda se queda esperando el lock del índice hasta que la primera
    // commitea, y recién ahí ve el duplicado.
    const outcomes = await Promise.all([
      processPagoparWebhook(aviso(hashPedido, 150_000)),
      processPagoparWebhook(aviso(hashPedido, 150_000)),
    ]);

    const kinds = outcomes.map((outcome) => outcome.kind).sort();
    expect(kinds).toEqual(["aplicado", "repetido"]);

    // Una sola fila de idempotencia y un solo descuento.
    expect(await getTestDb().select().from(paymentEvents)).toHaveLength(1);
    expect(await getStatus(orderId)).toBe("pagado");
    expect(await getOnHand(variantId)).toBe(3);

    // Y una sola transición registrada, no dos.
    const transiciones = (
      await getTestDb()
        .select()
        .from(orderEvents)
        .where(eq(orderEvents.orderId, orderId))
    ).filter((row) => row.toStatus === "pagado");
    expect(transiciones).toHaveLength(1);
  });

  it("cinco avisos idénticos simultáneos: un solo cobro", async () => {
    const variantId = await createVariant({ onHand: 5, pricePyg: 75_000 });
    const { orderId, hashPedido } = await pedidoConPagopar({
      variantId,
      qty: 2,
      totalPyg: 150_000,
      reservedUntil: new Date(Date.now() + HOUR),
      reservationExpiresAt: new Date(Date.now() + HOUR),
    });
    expect(await getStatus(orderId)).toBe("pendiente_pago");

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () =>
        processPagoparWebhook(aviso(hashPedido, 150_000))
      )
    );

    expect(
      outcomes.filter((outcome) => outcome.kind === "aplicado")
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.kind === "repetido")
    ).toHaveLength(4);
    expect(await getOnHand(variantId)).toBe(3);
    expect(await getTestDb().select().from(paymentEvents)).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 5. El sobreventa por el otro lado: reservar mientras se cobra
  // ---------------------------------------------------------------------------

  it("cobrar y reservar a la vez no deja on_hand por debajo de lo real", async () => {
    const variantId = await createVariant({ onHand: 2, pricePyg: 75_000 });
    const { hashPedido } = await pedidoConPagopar({
      variantId,
      qty: 2,
      totalPyg: 150_000,
      reservedUntil: new Date(Date.now() + HOUR),
      reservationExpiresAt: new Date(Date.now() + HOUR),
    });

    const rival = await insertBareOrder({ paymentMethod: "tarjeta" });

    const [, reserva] = await Promise.allSettled([
      processPagoparWebhook(aviso(hashPedido, 150_000)),
      reserveStock(rival, [{ variantId, qty: 1 }], {
        expiresAt: new Date(Date.now() + HOUR),
      }),
    ]);

    // Las 2 unidades ya estaban reservadas por el pedido que cobró: el rival no
    // puede llevarse nada, ni antes ni después del cobro.
    expect(reserva.status).toBe("rejected");
    expect((reserva as PromiseRejectedResult).reason).toBeInstanceOf(
      InsufficientStockError
    );
    expect(await getOnHand(variantId)).toBe(0);
  });

  it("si la base aborta la reserva por conflicto de locks, el comprador no ve el error crudo", async () => {
    /*
     * El test de arriba fallaba una de cada diez corridas de la suite entera:
     * `reserveStock` volvía con un error crudo de la base —"Failed query:
     * select `qty` from `stock_reservations`"— en vez de
     * `InsufficientStockError`.
     *
     * No era el test. Las dos transacciones toman los mismos locks en orden
     * distinto —la reserva entra por `variants` y sigue a
     * `stock_reservations`, el pago entra por el pedido— y MySQL rompe el
     * empate matando a una. El `sort` por id de variante de `reserveStock` no
     * ayuda contra una transacción que viene por otras tablas. Del lado del
     * comprador eso es un 500 al apretar "comprar".
     *
     * Reproducirlo a pedido no se puede: son dos transacciones peleando por
     * microsegundos, y repetir el choque 40 veces seguidas no lo provocó ni una
     * vez. Entonces el conflicto se **inyecta**: la base tira lo que tira, y lo
     * que se prueba es que el camino del comprador lo absorbe. Eso es
     * exactamente lo que puede volver a romperse si alguien saca el
     * `withLockRetry` de `reserveStock`.
     */
    const variantId = await createVariant({ onHand: 5, pricePyg: 50_000 });
    const orderId = await insertBareOrder({ paymentMethod: "tarjeta" });

    const db = getTestDb();
    const real = db.transaction.bind(db);
    let intentos = 0;

    vi.spyOn(db, "transaction").mockImplementation(((
      ...args: Parameters<typeof real>
    ) => {
      intentos += 1;
      if (intentos === 1) {
        // Tal cual llega: mysql2 adentro del envoltorio de drizzle.
        return Promise.reject(
          new Error("Failed query: select `qty` from `stock_reservations`", {
            cause: Object.assign(
              new Error("Deadlock found when trying to get lock"),
              {
                code: "ER_LOCK_DEADLOCK",
                errno: 1213,
              }
            ),
          })
        );
      }
      return real(...args);
    }) as typeof real);

    const resultado = await reserveStock(orderId, [{ variantId, qty: 1 }], {
      expiresAt: new Date(Date.now() + HOUR),
    });

    // Reintentó y la reserva quedó hecha: una sola, no dos.
    expect(intentos).toBe(2);
    expect(resultado).toEqual({ reserved: 1 });

    const held = await getTestDb()
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.variantId, variantId));
    expect(held.filter((row) => row.state === "held")).toHaveLength(1);
  });

  it("un `sin stock` NO se reintenta: es una respuesta, no una falla", async () => {
    // La otra mitad del arreglo, y la más fácil de romper de un manotazo:
    // reintentar cualquier error convertiría cada "no hay stock" en tres
    // transacciones y, el día que la reserva tenga efectos parciales, en
    // duplicados.
    const variantId = await createVariant({ onHand: 0, pricePyg: 50_000 });
    const orderId = await insertBareOrder({ paymentMethod: "tarjeta" });

    const db = getTestDb();
    const real = db.transaction.bind(db);
    let intentos = 0;
    vi.spyOn(db, "transaction").mockImplementation(((
      ...args: Parameters<typeof real>
    ) => {
      intentos += 1;
      return real(...args);
    }) as typeof real);

    await expect(
      reserveStock(orderId, [{ variantId, qty: 1 }], {
        expiresAt: new Date(Date.now() + HOUR),
      })
    ).rejects.toBeInstanceOf(InsufficientStockError);

    expect(intentos).toBe(1);
  });
});
