/**
 * Cuánto puede pesar cada archivo que se sube a la tienda.
 *
 * Viven juntos, y sin imports, porque los lee también `next.config.ts`: las
 * subidas van por server actions, y Next corta el body de una server action
 * en **1 MB** si no se le dice otra cosa (y el proxy en 10 MB). Con el default,
 * la foto de un comprobante de 2 MB —lo normal desde un celular— nunca llegaba
 * a `validateReceipt`: Next respondía 413 antes y la compradora veía la
 * pantalla de error. `tests/unit/upload-limits.test.ts` verifica que el techo
 * de `next.config.ts` cubra el más grande de estos.
 */

/** Comprobante de transferencia (JPG, PNG o PDF). */
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

/** Foto de producto, de categoría o QR del banco. */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Planilla de la carga masiva de productos (CSV o Excel). La acción
 * (`src/app/actions/admin-products.ts`) tiene su propia copia,
 * `MAX_CATALOG_FILE_BYTES`, a propósito: tocar ese archivo hace chocar la
 * sincronización de las tiendas que no trajeron la carga por planilla. El
 * test de este archivo verifica que las dos digan lo mismo.
 */
export const CATALOG_FILE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Lo que Next acepta en el body de una server action o del proxy: el archivo
 * más grande más 1 MB para el resto del multipart (los otros campos y los
 * separadores).
 */
export const ACTION_BODY_MAX_BYTES =
  Math.max(RECEIPT_MAX_BYTES, PRODUCT_IMAGE_MAX_BYTES, CATALOG_FILE_MAX_BYTES) + 1024 * 1024;
