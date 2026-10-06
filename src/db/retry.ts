/**
 * Reintento de las transacciones que MySQL aborta por conflicto de locks.
 *
 * Dos transacciones que toman los mismos locks en orden distinto se traban, y
 * MySQL rompe el empate **matando a una de las dos**. Eso no es un bug ni un
 * error del que la hizo: es el mecanismo normal, y la documentación de MySQL
 * dice explícitamente que la aplicación tiene que reintentar. Sin reintento, el
 * que perdió el empate recibe un error crudo de la base.
 *
 * Dónde duele acá: reservar stock (el comprador que aprieta "comprar") toma
 * `variants` y después `stock_reservations`; aplicar un pago toma el pedido y
 * sus reservas en otro orden. `reserveStock` ya ordena por id de variante para
 * que dos reservas no se traben entre sí, pero ese orden no ayuda contra una
 * transacción que toca **otras tablas**. Cuando chocan, el comprador se comía
 * un 500 en vez del "sin stock" que el código quiere darle.
 *
 * Ojo con dónde se usa: reintentar sólo tiene sentido cuando uno es dueño de la
 * transacción. Adentro de una transacción ajena que ya fue abortada, cualquier
 * query siguiente falla igual — ahí el reintento le toca al de afuera.
 */

/** Códigos de mysql2 para "perdiste el empate, volvé a intentar". */
export const LOCK_CONFLICT_CODES = ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'] as const;

/** Los mismos, por número: según el driver y la versión viene uno o el otro. */
export const LOCK_CONFLICT_ERRNOS = [1213, 1205] as const;

/** Intentos totales, no reintentos. */
export const LOCK_RETRY_ATTEMPTS = 3;

/**
 * ¿Este error es un conflicto de locks?
 *
 * Mira el error y también su `cause`: drizzle envuelve lo que tira mysql2 en su
 * propio error ("Failed query: ...") y el código queda una capa más abajo.
 */
export function isLockConflict(error: unknown): boolean {
  for (let actual: unknown = error, saltos = 0; actual != null && saltos < 5; saltos += 1) {
    if (typeof actual !== 'object') return false;

    const { code, errno } = actual as { code?: unknown; errno?: unknown };
    if (typeof code === 'string' && (LOCK_CONFLICT_CODES as readonly string[]).includes(code)) {
      return true;
    }
    if (typeof errno === 'number' && (LOCK_CONFLICT_ERRNOS as readonly number[]).includes(errno)) {
      return true;
    }

    actual = (actual as { cause?: unknown }).cause;
  }

  return false;
}

/**
 * Corre `run` y lo reintenta si la base abortó la transacción por un conflicto
 * de locks. Cualquier otro error sale derecho, sin reintentar: un
 * `InsufficientStockError` es una respuesta, no una falla.
 *
 * La espera entre intentos lleva jitter. Sin él, las dos transacciones que
 * chocaron vuelven a arrancar exactamente al mismo milisegundo y vuelven a
 * chocar — el mismo criterio que el cliente de Pagopar usa para sus reintentos.
 */
export async function withLockRetry<T>(
  run: () => Promise<T>,
  options: { attempts?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? LOCK_RETRY_ATTEMPTS;
  let ultimo: unknown;

  for (let intento = 1; intento <= attempts; intento += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isLockConflict(error)) throw error;

      ultimo = error;
      // Sólo cantidades: el log del comercio no es lugar para el detalle de
      // una query.
      console.warn(`db: conflicto de locks, reintento ${intento}/${attempts}`);

      if (intento < attempts) {
        await esperar(10 * intento + Math.floor(Math.random() * 25));
      }
    }
  }

  throw ultimo;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
