/**
 * Backfills escritos a mano que viajan **adentro** de una migración.
 *
 * Casi ninguna migración de este repo backfillea nada: inventar el pasado es
 * peor que no tenerlo (ver el comentario de `order_events.actor_user_id`). La
 * excepción es cuando una invariante nueva de `pnpm reconcile` nacería roja en
 * toda tienda que ya venía operando — ahí no backfillear no es prudencia, es
 * dejarle al dueño una alarma encendida el primer día y ninguna forma de
 * apagarla.
 *
 * Viven acá y no sueltos en el `.sql` por un motivo concreto: el test de
 * integración que los ejercita corre contra una base **ya migrada** (el
 * `global-setup` aplica `drizzle/` antes de que exista un solo dato), así que
 * el test tiene que poder ejecutar exactamente las mismas sentencias contra
 * datos que él mismo siembra. Compartir la constante es lo que garantiza que
 * lo testeado y lo que corre en producción sean el mismo SQL; un test unitario
 * verifica además que el archivo de migración las contenga textualmente.
 *
 * Todas tienen que ser **idempotentes**: `db:push`, `POST /api/setup/init` y
 * un `migrate()` reintentado pueden pasarles por encima más de una vez.
 */

/**
 * `refunds` + `payments.refunded_pyg` (migración 0012, plan-operacion §2).
 *
 * Antes del ledger, una devolución total era `payments.status = 'refunded'` y
 * nada más: no quedaba ni el monto ni quién la hizo. Las dos invariantes que
 * O7 agrega a `reconcile` —`refunded_pyg = Σ refunds` y
 * `status = 'refunded' ⇔ refunded_pyg = amount_pyg`— darían rojas en cada
 * tienda con una devolución histórica si esas filas no existieran.
 *
 * El `actor` dice `migracion` a propósito: es verdad y es lo único honesto que
 * se puede escribir. No sabemos quién autorizó esa devolución, y poner el
 * dueño actual sería inventar una atribución.
 *
 * `created_at` sale de `payments.updated_at` —el instante en que ese pago pasó
 * a `refunded`— y no de `NOW()`: fechar hoy una devolución de marzo mueve la
 * plata de mes en cualquier reporte por fecha.
 */
export const REFUNDS_LEDGER_BACKFILL: readonly string[] = [
  // Primero el acumulado. `refunded_pyg = 0` es el guardarraíl de
  // idempotencia: una segunda corrida no encuentra nada que actualizar.
  //
  // El `updated_at` = `updated_at` no es ruido: la columna es
  // `ON UPDATE CURRENT_TIMESTAMP`, así que sin asignarla explícitamente este
  // UPDATE le pondría la fecha de la migración a **todos** los pagos
  // devueltos de la historia de la tienda — y con ella se iría el único dato
  // que dice cuándo se devolvió esa plata, que es justo el que la sentencia
  // siguiente copia al ledger. Asignar una columna a sí misma es lo que MySQL
  // entiende como "no la toques".
  'UPDATE `payments` SET `refunded_pyg` = `amount_pyg`, `updated_at` = `updated_at` ' +
    "WHERE `status` = 'refunded' AND `refunded_pyg` = 0 AND `amount_pyg` > 0",
  // Después la fila del ledger, sólo para los pagos devueltos que todavía no
  // tienen ninguna. El `LEFT JOIN … IS NULL` es lo que la hace repetible.
  'INSERT INTO `refunds` (`payment_id`, `amount_pyg`, `reason`, `actor`, `actor_user_id`, `created_at`) ' +
    "SELECT `p`.`id`, `p`.`amount_pyg`, 'devolución registrada antes del ledger', 'migracion', NULL, `p`.`updated_at` " +
    'FROM `payments` `p` LEFT JOIN `refunds` `r` ON `r`.`payment_id` = `p`.`id` ' +
    "WHERE `p`.`status` = 'refunded' AND `p`.`amount_pyg` > 0 AND `r`.`id` IS NULL",
];
