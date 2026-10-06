import { t, type MessageKey, type Params } from '@/i18n';

/**
 * Los errores del dominio que **una persona lee** (PLAN.md FASE 2, PR S).
 *
 * Antes cada `throw` llevaba su prosa adentro: `new CheckoutError("El carrito
 * está vacío.")`. Funciona, y es exactamente lo que hace imposible traducir un
 * template: los textos que la compradora ve quedan repartidos por veinte
 * archivos de dominio, y quien traduce tiene que ir a buscarlos ahí adentro,
 * entre transacciones y bloqueos de fila.
 *
 * Acá el `throw` lleva una **clave** del catálogo y sus parámetros. El texto
 * se arma al construir el error, así que `error.message` sigue siendo lo que
 * era —lo leen los formularios, los logs y `adminActionError` sin cambiar una
 * línea— y además queda el `code`, que es lo que faltaba: se puede preguntar
 * *qué* pasó sin comparar strings.
 *
 * El idioma es una constante de build (ver `src/i18n`), así que resolver el
 * texto en el `throw` y no en el `catch` no pierde nada.
 *
 * **Qué NO se traduce.** Los errores que sólo lee un desarrollador siguen
 * siendo `Error` a secas con su mensaje técnico: un `qty inválida para la
 * variante 3` no va a un catálogo, porque nadie lo va a leer en guaraní y
 * porque un stack trace tiene que decir exactamente qué pasó.
 */
export class DomainError extends Error {
  /** La clave del catálogo. Para preguntar qué pasó sin comparar prosa. */
  readonly code: MessageKey;
  readonly params?: Params;

  constructor(code: MessageKey, params?: Params) {
    super(t(code, params));
    this.code = code;
    this.params = params;
    this.name = 'DomainError';
  }
}
