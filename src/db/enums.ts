/**
 * Los valores de los ENUM que también necesita el navegador, sin ninguna
 * dependencia.
 *
 * Viven acá y no en `src/db/schema.ts` por el mismo motivo que los roles en
 * `src/lib/roles.ts`: `schema.ts` define cada tabla con `mysqlTable(...)` al
 * alcance del módulo —llamadas con efecto, no puras—, así que ningún bundler
 * puede tree-shakear el resto del archivo (ni su `import` de `drizzle-orm`)
 * porque un componente cliente use un array de strings. Medido: ~17 KB gz de
 * `drizzle-orm` en el chunk compartido de las pantallas del panel
 * (`tests/e2e/presupuesto.spec.ts`, fase S12).
 *
 * `schema.ts` importa de acá y los re-exporta, así que sigue habiendo **una
 * sola** lista: el ENUM de MySQL y lo que dibuja el navegador no se pueden
 * separar. El lado del servidor no cambia un import.
 *
 * Regla de este archivo: **nunca** un `import` de `drizzle-orm` ni de nada que
 * lo arrastre. `tests/unit/db-enums.test.ts` lo verifica leyendo el fuente.
 */

export const ORDER_STATUSES = [
  'pendiente_pago',
  'esperando_verificacion',
  'pagado',
  'preparando',
  'enviado',
  'entregado',
  'rechazado',
  'vencido',
  'cancelado',
  'reembolsado',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ['transferencia', 'contra_entrega', 'tarjeta'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const COUPON_TYPES = ['porcentaje', 'monto_fijo'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

export const DOC_TYPES = ['RUC', 'CI', 'NINGUNO'] as const;
export type DocType = (typeof DOC_TYPES)[number];

/**
 * Las tasas de IVA. Están acá y no en el schema por el mismo camino que las
 * demás, sólo que más largo: `src/lib/money.ts` las importa para validar una
 * tasa, y `money.ts` (el `formatGs` de toda la vidriera) lo importa media
 * docena de componentes cliente. Una constante de tres números arrastraba el
 * ORM entero a la home.
 */
export const IVA_RATES = [10, 5, 0] as const;
export type IvaRate = (typeof IVA_RATES)[number];

/**
 * Los roles ya vivían fuera del schema por la misma razón (el proxy corre en
 * el edge). Se re-exportan acá para que el navegador tenga **un** lugar donde
 * buscar los valores de enum.
 */
export { USER_ROLES, type UserRole } from '../lib/roles';
