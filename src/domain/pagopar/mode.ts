/**
 * Modo de operación de Pagopar: `real` (default) o `mock`.
 *
 * `PAGOPAR_MODE=mock` levanta una pasarela simulada en memoria —sin red, sin
 * credenciales— para poder demostrar el ciclo completo del pedido
 * (checkout → aviso de pago → `pagado`) sin una cuenta de Pagopar.
 *
 * La única regla que importa acá es la del final de este archivo: **el modo
 * mock no existe en producción**. No es una preferencia de configuración, es
 * un candado. Una pasarela simulada corriendo en el sitio real marca pedidos
 * como pagados sin que haya entrado un guaraní, así que la puerta se cierra en
 * dos lugares distintos:
 *
 *   1. `isPagoparMockMode()` devuelve `false` con `NODE_ENV=production`,
 *      cualquiera sea el valor de `PAGOPAR_MODE` — el código de producción
 *      nunca *elige* el camino simulado;
 *   2. `assertMockAllowed()` **tira** si alguien igual llama a una función del
 *      simulador (un import directo, un script, un test mal escrito) — el
 *      camino simulado tampoco se puede *forzar*.
 *
 * Lo primero solo alcanzaría mientras nadie importe `mock.ts` a mano. Lo
 * segundo es lo que hace que eso sea imposible.
 *
 * Este módulo es el **único** lugar del repo que lee `PAGOPAR_MODE`; hay un
 * test que lo verifica (`tests/unit/pagopar-mock-mode.test.ts`), para que la
 * decisión no se replique en un `if` suelto que se olvide del guard.
 */

/** Valor de `PAGOPAR_MODE` que enciende el simulador. */
export const PAGOPAR_MOCK_MODE = "mock";

/** Se intentó usar el simulador en producción. */
export class PagoparMockInProductionError extends Error {
  constructor(readonly entryPoint: string) {
    super(`El modo mock de Pagopar no está disponible en producción (se llamó a ${entryPoint})`);
    this.name = "PagoparMockInProductionError";
  }
}

function isProduction(): boolean {
  return (process.env.NODE_ENV ?? "").trim() === "production";
}

/**
 * ¿Está encendido el simulador?
 *
 * Se lee el entorno en cada llamada, no al importar el módulo: los tests
 * cambian `NODE_ENV`/`PAGOPAR_MODE` entre casos y un valor congelado en el
 * import haría que el candado se probara contra una foto vieja.
 */
export function isPagoparMockMode(): boolean {
  // El orden importa: producción gana siempre, incluso con PAGOPAR_MODE=mock.
  if (isProduction()) return false;
  return (process.env.PAGOPAR_MODE ?? "").trim().toLowerCase() === PAGOPAR_MOCK_MODE;
}

/**
 * Guard de entrada de todo el simulador.
 *
 * Lo llama cada función pública de `mock.ts` y la página `/dev/pagopar`. En
 * producción no devuelve `false`: tira, porque llegar hasta acá ya significa
 * que alguien encontró la forma de invocar el simulador, y devolver un valor
 * de mentira sería peor que cortar.
 */
export function assertMockAllowed(entryPoint: string): void {
  if (isProduction()) throw new PagoparMockInProductionError(entryPoint);
}

/**
 * Prende el simulador para el proceso actual, sin pasar por `.env`.
 *
 * Sólo la usa `scripts/demo.ts`, para que el pedido con tarjeta de la demo
 * funcione sin que quien la corre tenga que acordarse de configurar
 * `PAGOPAR_MODE=mock` a mano. La escritura a `process.env` vive acá adentro
 * — no en `demo.ts` — porque este es el único archivo del repo al que se le
 * permite tocar la variable (`tests/unit/pagopar-mock-mode.test.ts` lo
 * verifica); si `demo.ts` la escribiera directamente, sería una segunda
 * fuente de verdad sobre cómo se enciende el modo mock.
 */
export function enableMockModeForDemo(): void {
  if (isProduction()) throw new PagoparMockInProductionError('enableMockModeForDemo');
  process.env.PAGOPAR_MODE = PAGOPAR_MOCK_MODE;
}
