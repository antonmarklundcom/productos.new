/**
 * Los roles del panel, sin dependencias.
 *
 * Viven en su propio módulo y no en `src/db/schema.ts` por una razón muy
 * concreta: `src/proxy.ts` corre en el runtime **edge** y necesita la lista
 * para decidir si una cookie es de alguien del panel. Importarla de
 * `schema.ts` le arrastraría al bundle del edge el grafo entero de
 * `drizzle-orm/mysql-core` — que hoy tolera y mañana no.
 *
 * `schema.ts` importa de acá, así que sigue habiendo **una sola** lista: el
 * ENUM de MySQL, los guards y el proxy no se pueden separar.
 *
 * Orden: de más a menos poder.
 *
 * - `owner`    — todo, más lo que no se delega: usuarios, reembolsos, exports.
 * - `staff`    — la operación diaria: pedidos, comprobantes, productos, stock.
 * - `vendedor` — sólo el mostrador: ve pedidos y los despacha. Sin plata.
 *
 * La matriz completa, acción por acción, está en ARCH.md §1.
 */
export const USER_ROLES = ['owner', 'staff', 'vendedor'] as const;

export type UserRole = (typeof USER_ROLES)[number];
