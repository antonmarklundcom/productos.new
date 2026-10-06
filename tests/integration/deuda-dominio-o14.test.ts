import { seedPaymentReadiness } from "../helpers/db";
import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getCatalog } from "../../src/db/queries";
import { orders, payments, products, variants } from "../../src/db/schema";
import {
  listAdminCategories,
  setCategoryImage,
} from "../../src/domain/admin-categories";
import {
  createProduct,
  listAdminProducts,
  updateProduct,
} from "../../src/domain/admin-products";
import { createOrder as placeOrder } from "../../src/domain/create-order";
import { transitionOrder } from "../../src/domain/orders";
import {
  findUnmatchedPayments,
  getPaymentForOrder,
  refundPayment,
} from "../../src/domain/payment-recovery";
import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createCategory, createVariant } from "../helpers/factories";

/**
 * La deuda de dominio que las fases Sonnet dejaron anotada en
 * `KNOWN-ISSUES.md` y que O14 cobra (fable/plan-crecimiento.md §5.1).
 *
 * Cada bloque acá es una entrada que se borra de ese archivo: sin el test, la
 * próxima fase de piel vuelve a quedarse sin el dato y a escribir el mismo
 * workaround.
 */
describe.skipIf(!hasTestDb)("O14 — deuda de dominio", () => {
  beforeEach(async () => {
    await resetTables();
    await seedPaymentReadiness();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  // -------------------------------------------------------------------------
  // Destacados: el panel no tenía cómo marcar ni cómo listar
  // -------------------------------------------------------------------------

  describe("destacados", () => {
    async function unProducto(
      categoryId: number,
      isFeatured: boolean
    ): Promise<number> {
      const slug = `prod-${randomBytes(4).toString("hex")}`;
      const id = await createProduct({
        slug,
        name: `Producto ${slug}`,
        description: null,
        categoryId,
        brand: null,
        ivaRate: 10,
        isActive: true,
        published: true,
        isFeatured,
      });
      await getTestDb()
        .insert(variants)
        .values({
          productId: id,
          sku: `SKU-${randomBytes(4).toString("hex").toUpperCase()}`,
          label: "Único",
          pricePyg: 120_000,
          onHand: 5,
        });
      return id;
    }

    it("un producto guardado como destacado se ve destacado en el listado y en la vidriera", async () => {
      const categoryId = await createCategory();
      const destacadoId = await unProducto(categoryId, true);
      await unProducto(categoryId, false);

      const { rows } = await listAdminProducts();
      const fila = rows.find((row) => row.id === destacadoId);
      expect(fila?.isFeatured).toBe(true);
      expect(rows.filter((row) => row.isFeatured)).toHaveLength(1);

      const vidriera = await getCatalog({ featured: true });
      expect(vidriera.map((p) => p.id)).toEqual([destacadoId]);
    });

    it('el filtro "destacados" trae sólo los destacados, y sin filtro vienen todos', async () => {
      const categoryId = await createCategory();
      const destacadoId = await unProducto(categoryId, true);
      await unProducto(categoryId, false);

      const soloDestacados = await listAdminProducts({ featured: true });
      expect(soloDestacados.total).toBe(1);
      expect(soloDestacados.rows.map((row) => row.id)).toEqual([destacadoId]);

      const noDestacados = await listAdminProducts({ featured: false });
      expect(noDestacados.total).toBe(1);
      expect(noDestacados.rows[0]?.id).not.toBe(destacadoId);

      expect((await listAdminProducts()).total).toBe(2);
    });

    it("guardar sin tocar el campo no des-destaca un producto", async () => {
      const categoryId = await createCategory();
      const id = await unProducto(categoryId, true);
      const slug = (
        await getTestDb().select().from(products).where(eq(products.id, id))
      )[0]?.slug;
      if (!slug) throw new Error("no pude releer el producto");

      // El formulario que no dibuja la casilla manda `undefined`.
      await updateProduct(id, {
        slug,
        name: "Renombrado",
        description: null,
        categoryId,
        brand: null,
        ivaRate: 10,
        isActive: true,
        published: true,
      });

      const fila = (await listAdminProducts()).rows.find(
        (row) => row.id === id
      );
      expect(fila?.isFeatured).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Categorías: el formulario de edición no tenía con qué prellenarse
  // -------------------------------------------------------------------------

  describe("listAdminCategories", () => {
    it("trae descripción, foto y alt para prellenar el formulario", async () => {
      const categoryId = await createCategory();
      await setCategoryImage({
        categoryId,
        imageCloudinaryId: "categorias/lenceria",
        imageAlt: "Vitrina de lencería",
      });

      const fila = (await listAdminCategories()).find(
        (row) => row.id === categoryId
      );
      expect(fila?.imageCloudinaryId).toBe("categorias/lenceria");
      expect(fila?.imageAlt).toBe("Vitrina de lencería");
      // Una categoría sin descripción devuelve `null`, no `undefined`: el
      // formulario dibuja un campo vacío, no "undefined".
      expect(fila?.description).toBeNull();
    });

    it("reemplazar la foto devuelve la anterior para que la acción la borre del CDN", async () => {
      const categoryId = await createCategory();
      const primera = await setCategoryImage({
        categoryId,
        imageCloudinaryId: "categorias/vieja",
      });
      expect(primera.previousCloudinaryId).toBeNull();

      const segunda = await setCategoryImage({
        categoryId,
        imageCloudinaryId: "categorias/nueva",
      });
      expect(segunda.previousCloudinaryId).toBe("categorias/vieja");

      // Subir la misma foto dos veces no pide borrar la que se acaba de poner.
      const tercera = await setCategoryImage({
        categoryId,
        imageCloudinaryId: "categorias/nueva",
      });
      expect(tercera.previousCloudinaryId).toBeNull();

      const fila = (await listAdminCategories()).find(
        (row) => row.id === categoryId
      );
      expect(fila?.imageCloudinaryId).toBe("categorias/nueva");
    });

    it("cambiar la foto sin mandar alt conserva el alt que ya había", async () => {
      const categoryId = await createCategory();
      await setCategoryImage({
        categoryId,
        imageCloudinaryId: "categorias/uno",
        imageAlt: "Alt original",
      });
      await setCategoryImage({
        categoryId,
        imageCloudinaryId: "categorias/dos",
      });

      const fila = (await listAdminCategories()).find(
        (row) => row.id === categoryId
      );
      expect(fila?.imageAlt).toBe("Alt original");
    });
  });

  // -------------------------------------------------------------------------
  // Reembolsos: "ya devuelto" arrancaba en 0 en cada carga de pantalla
  // -------------------------------------------------------------------------

  describe("el pago de un pedido", () => {
    /** Un pedido de tarjeta con su pago acreditado. */
    async function pedidoPagado(status: "vencido" | "enviado") {
      const variantId = await createVariant({ onHand: 3, pricePyg: 90_000 });
      const order = await placeOrder({
        items: [{ variantId, qty: 1 }],
        customerName: "Ana López",
        customerPhone: "0981123456",
        docType: "NINGUNO",
        isConsumidorFinal: true,
        shipCity: "Asunción",
        shipAddress: "Av. Mcal. López 1234",
        paymentMethod: "tarjeta",
      });

      const db = getTestDb();
      await db.insert(payments).values({
        orderId: order.orderId,
        provider: "pagopar",
        providerRef: randomBytes(16).toString("hex"),
        amountPyg: order.totalPyg,
        status: "paid",
      });

      if (status === "vencido") {
        await transitionOrder(
          order.orderId,
          "vencido",
          "cron",
          "sin pago a tiempo"
        );
      } else {
        await transitionOrder(
          order.orderId,
          "pagado",
          "admin:duena@tienda.py",
          "pago acreditado"
        );
        await transitionOrder(
          order.orderId,
          "preparando",
          "admin:duena@tienda.py",
          "a preparar"
        );
        await transitionOrder(
          order.orderId,
          "enviado",
          "admin:duena@tienda.py",
          "despachado"
        );
      }

      const paymentId = (
        await db
          .select({ id: payments.id })
          .from(payments)
          .where(eq(payments.orderId, order.orderId))
      )[0]?.id;
      if (!paymentId) throw new Error("no pude crear el pago");

      return { ...order, paymentId };
    }

    it("un reembolso parcial se ve después de recargar la pantalla", async () => {
      const pedido = await pedidoPagado("vencido");

      await refundPayment({
        paymentId: pedido.paymentId,
        reason: "se quedó con una sola remera",
        actor: "admin:duena@tienda.py",
        amountPyg: 30_000,
      });

      // Ésta es la relectura que antes devolvía siempre 0.
      const [colgado] = await findUnmatchedPayments();
      expect(colgado?.refundedPyg).toBe(30_000);

      const pago = await getPaymentForOrder(pedido.orderId);
      expect(pago).toMatchObject({
        paymentId: pedido.paymentId,
        provider: "pagopar",
        amountPyg: pedido.totalPyg,
        refundedPyg: 30_000,
      });
    });

    it("trae el pago de un pedido vivo, que es justo el que la lista de colgados excluye", async () => {
      const pedido = await pedidoPagado("enviado");

      // El pedido está `enviado`: la lista de plata colgada no lo muestra, a
      // propósito. La ficha del pedido sí necesita su pago para devolver.
      expect(await findUnmatchedPayments()).toEqual([]);

      const pago = await getPaymentForOrder(pedido.orderId);
      expect(pago?.paymentId).toBe(pedido.paymentId);
      expect(pago?.refundedPyg).toBe(0);
    });

    it("un pedido sin pago cobrado devuelve null, y eso no es un error", async () => {
      const variantId = await createVariant({ onHand: 2, pricePyg: 50_000 });
      const order = await placeOrder({
        items: [{ variantId, qty: 1 }],
        customerName: "Ana López",
        customerPhone: "0981123456",
        docType: "NINGUNO",
        isConsumidorFinal: true,
        shipCity: "Asunción",
        shipAddress: "Av. Mcal. López 1234",
        paymentMethod: "transferencia",
      });

      expect(await getPaymentForOrder(order.orderId)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // El schema de este plan (§2): la marca del recordatorio, que usa O15
  // -------------------------------------------------------------------------

  it("orders.payment_reminder_sent_at nace en NULL", async () => {
    const variantId = await createVariant({ onHand: 2, pricePyg: 50_000 });
    const order = await placeOrder({
      items: [{ variantId, qty: 1 }],
      customerName: "Ana López",
      customerPhone: "0981123456",
      docType: "NINGUNO",
      isConsumidorFinal: true,
      shipCity: "Asunción",
      shipAddress: "Av. Mcal. López 1234",
      paymentMethod: "transferencia",
    });

    const fila = (
      await getTestDb()
        .select({ marca: orders.paymentReminderSentAt })
        .from(orders)
        .where(eq(orders.id, order.orderId))
    )[0];
    expect(fila?.marca).toBeNull();
  });
});
