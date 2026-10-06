import { and, count, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { products, shippingZones } from "@/db/schema";

import { SEED_PRODUCTS } from "../../scripts/seed-data";
import type { Executor } from "./executor";

/**
 * Lo que el resumen del panel avisa antes de vender: errores de arranque que
 * no rompen nada visible y le cuestan plata a la tienda. `pnpm preflight` no
 * los puede ver —no se conecta a la base—.
 */

/**
 * ¿Quedan productos del catálogo de ejemplo a la venta?
 *
 * El setup (`POST /api/setup/init` con `"seed": true`) y `pnpm db:seed`
 * siembran auriculares, termos y remeras para ver la tienda andando. En una
 * tienda real eso es un problema que nadie ve: la dueña carga su catálogo y
 * los de ejemplo siguen publicados al lado — una lencería que vende
 * auriculares con stock de mentira, y un pedido real por algo que no existe.
 *
 * Se reconocen por el `slug` (fijo en `scripts/seed-data.ts`).
 */
export const DEMO_PRODUCT_SLUGS: readonly string[] = SEED_PRODUCTS.map((product) => product.slug);

export async function countActiveDemoProducts(executor?: Executor): Promise<number> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select({ n: count() })
    .from(products)
    .where(and(eq(products.isActive, true), inArray(products.slug, [...DEMO_PRODUCT_SLUGS])));
  return Number(rows[0]?.n ?? 0);
}

/**
 * ¿Hay alguna zona de envío activa? Sin ninguna, `quoteShipping` cotiza
 * ₲0 a cualquier ciudad (`sin_zonas`): el checkout anda y el comercio paga el
 * envío de cada pedido sin enterarse. Pasa con una tienda inicializada sin
 * `zonas` ni seed (DEPLOY.md §4).
 */
export async function countActiveShippingZones(executor?: Executor): Promise<number> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select({ n: count() })
    .from(shippingZones)
    .where(eq(shippingZones.isActive, true));
  return Number(rows[0]?.n ?? 0);
}
