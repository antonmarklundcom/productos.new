import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { categories, orders, products, variants, type OrderStatus, type PaymentMethod, type UserRole } from '../../src/db/schema';
import { createUser } from '../../src/lib/auth';

import { getTestDb } from './db';

export async function createCategory(slug = `cat-${randomBytes(4).toString('hex')}`): Promise<number> {
  const db = getTestDb();
  await db.insert(categories).values({ slug, name: slug });
  const row = (await db.select().from(categories).where(eq(categories.slug, slug)).limit(1))[0];
  if (!row) throw new Error('no pude crear la categoría');
  return row.id;
}

export async function createProduct(categoryId?: number): Promise<number> {
  const db = getTestDb();
  const slug = `prod-${randomBytes(4).toString('hex')}`;
  await db.insert(products).values({
    slug,
    name: slug,
    description: 'producto de prueba',
    categoryId: categoryId ?? (await createCategory()),
    ivaRate: 10,
    publishedAt: new Date(),
  });
  const row = (await db.select().from(products).where(eq(products.slug, slug)).limit(1))[0];
  if (!row) throw new Error('no pude crear el producto');
  return row.id;
}

export async function createVariant(options: { onHand: number; pricePyg?: number; productId?: number }): Promise<number> {
  const db = getTestDb();
  const sku = `SKU-${randomBytes(4).toString('hex').toUpperCase()}`;
  await db.insert(variants).values({
    productId: options.productId ?? (await createProduct()),
    sku,
    label: 'Único',
    pricePyg: options.pricePyg ?? 100000,
    onHand: options.onHand,
  });
  const row = (await db.select().from(variants).where(eq(variants.sku, sku)).limit(1))[0];
  if (!row) throw new Error('no pude crear la variante');
  return row.id;
}

export async function createOrder(
  options: {
    status?: OrderStatus;
    paymentMethod?: PaymentMethod;
    totalPyg?: number;
    customerPhone?: string;
    customerId?: number | null;
  } = {},
): Promise<number> {
  const db = getTestDb();
  const orderNumber = `PY-T${randomBytes(4).toString('hex').toUpperCase()}`;
  await db.insert(orders).values({
    orderNumber,
    accessToken: randomBytes(32).toString('hex'),
    status: options.status ?? 'pendiente_pago',
    customerName: 'Cliente de Prueba',
    customerPhone: options.customerPhone ?? '+595981123456',
    customerId: options.customerId ?? null,
    shipCity: 'Asunción',
    shipAddress: 'Av. Mcal. López 1234',
    paymentMethod: options.paymentMethod ?? 'transferencia',
    subtotalPyg: options.totalPyg ?? 100000,
    totalPyg: options.totalPyg ?? 100000,
  });
  const row = (await db.select().from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1))[0];
  if (!row) throw new Error('no pude crear el pedido');
  return row.id;
}

export async function getOnHand(variantId: number): Promise<number> {
  const db = getTestDb();
  const row = (await db.select().from(variants).where(eq(variants.id, variantId)).limit(1))[0];
  if (!row) throw new Error(`variante ${variantId} inexistente`);
  return row.onHand;
}

export async function getStatus(orderId: number): Promise<OrderStatus> {
  const db = getTestDb();
  const row = (await db.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0];
  if (!row) throw new Error(`pedido ${orderId} inexistente`);
  return row.status;
}

/**
 * Un usuario del panel de verdad.
 *
 * Desde el PR D, `order_events.actor_user_id` y `stock_adjustments.actor_user_id`
 * son FK contra `users`: un id inventado en un test ya no es "un número
 * cualquiera", es una fila que MySQL rechaza. Que los tests usen un usuario
 * real es además lo que pasa en producción — el id sale siempre de una sesión
 * abierta contra esta tabla.
 */
export async function createAdminUser(
  options: { email?: string; role?: UserRole } = {},
): Promise<number> {
  const email = options.email ?? `admin-${randomBytes(4).toString('hex')}@tienda.py`;
  const created = await createUser(
    { email, password: 'tienda2026segura', role: options.role ?? 'owner' },
    getTestDb(),
  );
  return created.id;
}
