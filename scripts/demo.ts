import "@/lib/load-env";

import { safeError } from "../src/lib/safe-error";

import { eq } from "drizzle-orm";

import { closePool, getDb } from "@/db";
import {
  orders,
  variants,
  type OrderStatus,
  type PaymentMethod,
} from "@/db/schema";
import { createOrder } from "@/domain/create-order";
import { transitionOrder } from "@/domain/orders";
import { startPagoparCheckout } from "@/domain/pagopar/checkout";
import { pagoparCheckoutUrl } from "@/domain/pagopar/config";
import { enableMockModeForDemo } from "@/domain/pagopar/mode";
import { recordReceipt } from "@/domain/receipts";

import { seedCatalog } from "./seed";

/**
 * `pnpm demo`: un solo comando que deja la base local en un estado que se
 * puede mostrar. Siembra el catálogo y crea un pedido de ejemplo en cada
 * estado de la máquina (ARCH.md §3), más uno con tarjeta parqueado en la
 * pasarela simulada de Pagopar.
 *
 * Idempotente: cada pedido de ejemplo se reconoce por el teléfono del
 * cliente (natural para `orders`, que no tiene una clave de negocio propia
 * fuera del `order_number` autogenerado). Si ya existe, se reusa en vez de
 * duplicarlo — correr `pnpm demo` de nuevo no llena la base de pedidos
 * repetidos.
 *
 * Nunca en producción: un demo que "vende" pedidos de mentira con plata que
 * nunca entró no puede correr donde haya plata de verdad.
 */

if ((process.env.NODE_ENV ?? "").trim() === "production") {
  console.error("✗ pnpm demo no corre con NODE_ENV=production.");
  process.exit(1);
}

// El pedido con tarjeta necesita el simulador de Pagopar; se enciende acá
// para que la demo funcione sin pedirle a quien la corre que configure
// `PAGOPAR_MODE=mock` a mano.
enableMockModeForDemo();

type DemoCustomer = {
  name: string;
  phone: string;
  docType: "CI" | "RUC" | "NINGUNO";
  docNumber?: string;
  city: string;
  barrio: string;
  address: string;
};

type DemoScenario = {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  customer: DemoCustomer;
  sku: string;
  qty: number;
};

// Teléfonos de la franja de prueba TSE (no asignados a números reales) —
// suficiente para reconocer "este pedido lo puso el demo" sin marcar nada en
// el schema.
const SCENARIOS: DemoScenario[] = [
  {
    status: "pendiente_pago",
    paymentMethod: "transferencia",
    sku: "YER-1KG-COM",
    qty: 2,
    customer: {
      name: "Marta Insfrán",
      phone: "0981700001",
      docType: "CI",
      docNumber: "3456781",
      city: "Asunción",
      barrio: "Recoleta",
      address: "Av. España 1234",
    },
  },
  {
    status: "esperando_verificacion",
    paymentMethod: "transferencia",
    sku: "AUR-TWS-NEG",
    qty: 1,
    customer: {
      name: "Rodrigo Bogado",
      phone: "0981700002",
      docType: "CI",
      docNumber: "4012345",
      city: "San Lorenzo",
      barrio: "Barrio San Vicente",
      address: "Mcal. López 890",
    },
  },
  {
    status: "pagado",
    paymentMethod: "contra_entrega",
    sku: "TER-1L-PLA",
    qty: 1,
    customer: {
      name: "Claudia Ovelar",
      phone: "0981700003",
      docType: "RUC",
      docNumber: "80045678-5",
      city: "Luque",
      barrio: "Barrio Molino",
      address: "Ruta Molas López km 3",
    },
  },
  {
    status: "enviado",
    paymentMethod: "transferencia",
    sku: "REM-BAS-M",
    qty: 3,
    customer: {
      name: "Diego Franco",
      phone: "0981700004",
      docType: "CI",
      docNumber: "2987654",
      city: "Fernando de la Mora",
      barrio: "Barrio Obrero",
      address: "Av. Cacique Lambaré 456",
    },
  },
  {
    status: "entregado",
    paymentMethod: "contra_entrega",
    sku: "ZAP-RUN-39",
    qty: 1,
    customer: {
      name: "Sofía Amarilla",
      phone: "0981700005",
      docType: "CI",
      docNumber: "5123456",
      city: "Capiatá",
      barrio: "Centro",
      address: "Ruta 2 km 18",
    },
  },
  {
    status: "cancelado",
    paymentMethod: "transferencia",
    sku: "PAR-20W-NEG",
    qty: 1,
    customer: {
      name: "Hugo Cardozo",
      phone: "0981700006",
      docType: "NINGUNO",
      city: "Ciudad del Este",
      barrio: "Km 4",
      address: "Av. Monseñor Rodríguez 210",
    },
  },
  {
    status: "vencido",
    paymentMethod: "transferencia",
    sku: "JAR-25L-VER",
    qty: 1,
    customer: {
      name: "Lorena Duarte",
      phone: "0981700007",
      docType: "CI",
      docNumber: "4789012",
      city: "Encarnación",
      barrio: "Barrio Roque González",
      address: "Av. Irrazábal 550",
    },
  },
];

// El pedido con tarjeta se maneja aparte: en vez de transicionar el estado a
// mano, corre `startPagoparCheckout()` de verdad y queda `pendiente_pago`,
// exactamente como quedaría un comprador que abrió la pasarela y todavía no
// pagó.
const TARJETA_CUSTOMER: DemoCustomer = {
  name: "Nicolás Benítez",
  phone: "0981700008",
  docType: "CI",
  docNumber: "3654210",
  city: "Asunción",
  barrio: "Villa Morra",
  address: "Av. San Martín 1500",
};
const TARJETA_SKU = "SMW-DEP-42";
const TARJETA_QTY = 1;

// Camino hacia cada estado, en pasos de `transitionOrder`: `createOrder` deja
// el pedido en `pendiente_pago`, así que sólo hace falta la cola.
const PATH_TO: Partial<Record<OrderStatus, OrderStatus[]>> = {
  pendiente_pago: [],
  esperando_verificacion: ["esperando_verificacion"],
  pagado: ["pagado"],
  enviado: ["pagado", "preparando", "enviado"],
  entregado: ["pagado", "preparando", "enviado", "entregado"],
  cancelado: ["cancelado"],
  vencido: ["vencido"],
};

async function findExistingOrderId(phone: string): Promise<number | null> {
  const db = getDb();
  const row = (
    await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.customerPhone, `+595${phone.slice(1)}`))
      .limit(1)
  )[0];
  return row?.id ?? null;
}

async function variantIdBySku(sku: string): Promise<number> {
  const db = getDb();
  const row = (
    await db
      .select({ id: variants.id })
      .from(variants)
      .where(eq(variants.sku, sku))
      .limit(1)
  )[0];
  if (!row) throw new Error(`No existe la variante ${sku} — ¿corrió el seed?`);
  return row.id;
}

async function ensureScenario(
  scenario: DemoScenario
): Promise<{ orderId: number; orderNumber: string }> {
  const existingId = await findExistingOrderId(scenario.customer.phone);
  if (existingId !== null) {
    const row = (
      await getDb()
        .select({ orderNumber: orders.orderNumber })
        .from(orders)
        .where(eq(orders.id, existingId))
        .limit(1)
    )[0]!;
    console.log(
      `· ${row.orderNumber} (${scenario.status}) ya existe — ${scenario.customer.name}`
    );
    return { orderId: existingId, orderNumber: row.orderNumber };
  }

  const variantId = await variantIdBySku(scenario.sku);
  const created = await createOrder({
    items: [{ variantId, qty: scenario.qty }],
    customerName: scenario.customer.name,
    customerPhone: scenario.customer.phone,
    docType: scenario.customer.docType,
    docNumber: scenario.customer.docNumber ?? null,
    isConsumidorFinal: scenario.customer.docType === "NINGUNO",
    shipCity: scenario.customer.city,
    shipBarrio: scenario.customer.barrio,
    shipAddress: scenario.customer.address,
    paymentMethod: scenario.paymentMethod,
  });

  for (const step of PATH_TO[scenario.status] ?? []) {
    await transitionOrder(
      created.orderId,
      step,
      "demo",
      "estado de ejemplo para pnpm demo"
    );
  }

  if (scenario.status === "esperando_verificacion") {
    // Comprobante de mentira: alcanza para que `/admin` muestre el pedido en
    // revisión. Sin Cloudinary configurado, el botón "Ver" del admin no va a
    // poder traer la imagen — no es un bug del demo, es que no hay archivo.
    await recordReceipt({
      orderId: created.orderId,
      cloudinaryId: "demo/comprobante-placeholder",
      mime: "image/png",
      bytes: 123_456,
    });
  }

  console.log(
    `✓ ${created.orderNumber} (${scenario.status}) — ${scenario.customer.name}`
  );
  return { orderId: created.orderId, orderNumber: created.orderNumber };
}

async function ensureTarjetaOrder(): Promise<void> {
  const existingId = await findExistingOrderId(TARJETA_CUSTOMER.phone);

  let orderId: number;
  let orderNumber: string;
  if (existingId !== null) {
    const row = (
      await getDb()
        .select({ orderNumber: orders.orderNumber })
        .from(orders)
        .where(eq(orders.id, existingId))
        .limit(1)
    )[0]!;
    orderId = existingId;
    orderNumber = row.orderNumber;
    console.log(
      `· ${orderNumber} (tarjeta, pendiente_pago) ya existe — ${TARJETA_CUSTOMER.name}`
    );
  } else {
    const variantId = await variantIdBySku(TARJETA_SKU);
    const created = await createOrder({
      items: [{ variantId, qty: TARJETA_QTY }],
      customerName: TARJETA_CUSTOMER.name,
      customerPhone: TARJETA_CUSTOMER.phone,
      docType: TARJETA_CUSTOMER.docType,
      docNumber: TARJETA_CUSTOMER.docNumber ?? null,
      isConsumidorFinal: TARJETA_CUSTOMER.docType === "NINGUNO",
      shipCity: TARJETA_CUSTOMER.city,
      shipBarrio: TARJETA_CUSTOMER.barrio,
      shipAddress: TARJETA_CUSTOMER.address,
      paymentMethod: "tarjeta",
    });
    orderId = created.orderId;
    orderNumber = created.orderNumber;
    console.log(
      `✓ ${orderNumber} (tarjeta, pendiente_pago) — ${TARJETA_CUSTOMER.name}`
    );
  }

  const { hashPedido } = await startPagoparCheckout(orderId);
  const link = pagoparCheckoutUrl(hashPedido);
  console.log("");
  console.log(
    `💳 Pedido con tarjeta parqueado en la pasarela simulada: ${orderNumber}`
  );
  console.log(`   ${link}`);
  console.log(
    "   Elegí un botón ahí para pagarlo, rechazarlo o repetir el aviso."
  );
}

async function main(): Promise<void> {
  console.log("Sembrando catálogo...");
  await seedCatalog(false);

  console.log("");
  console.log("Creando pedidos de ejemplo (uno por estado)...");
  for (const scenario of SCENARIOS) {
    await ensureScenario(scenario);
  }

  console.log("");
  console.log("Creando pedido con tarjeta (Pagopar mock)...");
  await ensureTarjetaOrder();

  console.log("");
  console.log(
    "Listo. pnpm dev y mostrá /admin/pedidos — hay un pedido en cada estado."
  );

  await closePool();
}

main().catch(async (error) => {
  console.error(safeError(error).message);
  await closePool();
  process.exit(1);
});
