import "dotenv/config";
import { v2 as sdk } from "cloudinary";

import { integracion } from "./integraciones";

/**
 * Cliente de Cloudinary, configurado **perezosamente**.
 *
 * Antes esto validaba las credenciales y llamaba a `config()` al importarse,
 * y un `import` que explota se lleva puesto a todo el que lo toca de rebote:
 * `domain/receipt-review.ts` importa `signedReceiptUrl` para la preview del
 * comprobante, así que aprobar un pedido —que es puro MySQL y no manda un solo
 * byte a Cloudinary— quedaba atado a tener credenciales cargadas. En CI, sin
 * las variables, el módulo entero de tests ni siquiera levantaba.
 *
 * Ahora se configura en el primer uso real. Importar nunca falla; si faltan
 * credenciales, falla la subida o la firma, que es lo único que de verdad las
 * necesita. Mismo patrón que el pool de `src/db/index.ts`, y la misma razón
 * por la que `src/lib/images.ts` arma las URLs públicas sin tocar este módulo.
 */

/** La última config aplicada al SDK: si el panel la cambia, se reconfigura. */
let aplicada: string | null = null;

function configure(): typeof sdk {
  // Panel > entorno > nada (src/lib/integraciones.ts). Sin credenciales en
  // ninguna de las dos fuentes, tira nombrando las variables de siempre.
  const { valores } = integracion("cloudinary");
  const faltan = [
    ...(valores.cloudName ? [] : ["CLOUDINARY_CLOUD_NAME"]),
    ...(valores.apiKey ? [] : ["CLOUDINARY_API_KEY"]),
    ...(valores.apiSecret ? [] : ["CLOUDINARY_API_SECRET"]),
  ];

  if (faltan.length > 0) {
    throw new Error(
      `Faltan variables de Cloudinary (${faltan.join(" / ")}). ` +
        "Cargalas en /admin/integraciones, o en .env.local — ver docs/ENV-OPCIONAL.md.",
    );
  }

  const firma = `${valores.cloudName}\u0000${valores.apiKey}\u0000${valores.apiSecret}`;
  if (aplicada === firma) return sdk;

  sdk.config({
    cloud_name: valores.cloudName ?? undefined,
    api_key: valores.apiKey ?? undefined,
    api_secret: valores.apiSecret ?? undefined,
    secure: true,
  });
  aplicada = firma;
  return sdk;
}

/**
 * Prefijo opcional de todas las carpetas de esta tienda (PLAN.md FASE 2, PR U).
 *
 * Vacío por defecto, que es el comportamiento de siempre: `productos/`,
 * `comprobantes/`, `banco/`. Con `CLOUDINARY_FOLDER_PREFIX="lenceria"` (o el
 * prefijo cargado en `/admin/integraciones`) pasan a ser `lenceria/productos/`
 * y compañía. Se resuelve en cada subida, no al importar: el panel lo puede
 * cambiar sin redeploy.
 *
 * Existe por una razón concreta y no por prolijidad: **el `public_id` de un
 * comprobante sale del número de pedido**, y los números de pedido se repiten
 * entre tiendas — todas acuñan `PY-000123`, a propósito (el prefijo participa
 * del hash de Pagopar, así que no es por tienda). Dos tiendas que comparten
 * una cuenta de Cloudinary sin prefijo terminan con los comprobantes de
 * `PY-000123` de las dos mezclados en la misma carpeta: quien administra esa
 * cuenta no puede distinguirlos, y el `-${Date.now()}` que los separa es un
 * desempate por milisegundo, no una separación por tienda. El prefijo es lo
 * que hace que sean dos carpetas distintas.
 *
 * **No se cambia con archivos ya subidos.** El `public_id` queda guardado
 * entero en la fila (`receipts.cloudinary_id`, `product_images.cloudinary_id`),
 * así que las imágenes viejas se siguen sirviendo desde donde están; lo que
 * cambia es a dónde van las nuevas. Mezclar dos prefijos en una tienda no
 * rompe nada, pero deja las fotos repartidas en dos árboles para siempre —
 * elegilo al crear la tienda y no lo toques más.
 */
function folderPrefix(): string {
  const raw = integracion("cloudinary").valores.folderPrefix ?? "";
  // Se acepta lo que escriba una persona apurada —`/lenceria/`, `lenceria//`—
  // y se guarda una sola forma: sin barras en las puntas.
  const limpio = raw.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  return limpio === "" ? "" : `${limpio}/`;
}

/** Carpeta pública: imágenes de producto, servidas directamente por CDN. */
export function carpetaProductos(): string {
  return `${folderPrefix()}productos`;
}

/**
 * Carpeta pública: la foto de portada de cada categoría (O7).
 *
 * Aparte de `productos/` y no adentro, por lo mismo que el QR del banco: son
 * assets de la tienda, no del catálogo, y mezclarlos hace imposible mirar la
 * carpeta y entender qué hay. Bajo el mismo prefijo, así que dos tiendas en la
 * misma cuenta de Cloudinary no se pisan.
 */
export function carpetaCategorias(): string {
  return `${folderPrefix()}categorias`;
}

/**
 * Carpeta **privada** de las copias de seguridad (O8).
 *
 * Las copias se suben con `resource_type: 'raw'` y `type: 'authenticated'`: sin
 * firma no se descargan. Un backup en una carpeta pública es la base de datos
 * entera del comercio servida por CDN a quien adivine la URL — con los
 * teléfonos, las direcciones y los comprobantes de todas las compradoras.
 */
export function carpetaBackups(): string {
  return `${folderPrefix()}backups`;
}

/**
 * ¿Hay credenciales de Cloudinary?
 *
 * Sin llamar a `configure()`, que tira: esto es una pregunta, no un uso. La
 * usa el backup para apagarse solo (no hay dónde guardar la copia) y
 * `pnpm preflight` para avisarlo.
 */
export function cloudinaryConfigured(): boolean {
  const { valores } = integracion("cloudinary");
  return Boolean(valores.cloudName && valores.apiKey && valores.apiSecret);
}

/**
 * Carpeta **pública** del QR SPI del comercio (PLAN.md FASE 2, PR T).
 *
 * Pública y separada de `comprobantes/` a propósito: ese folder es
 * `authenticated` y sólo se sirve con URL firmada, que es exactamente lo
 * contrario de lo que necesita una imagen que la compradora tiene que ver en
 * la página del pedido sin estar logueada en ningún lado. Meter el QR ahí
 * sería, además, poner un archivo del comercio adentro del folder donde viven
 * los comprobantes de pago de sus clientas.
 */
export function carpetaBanco(): string {
  return `${folderPrefix()}banco`;
}

/**
 * Carpeta **pública** de la foto de portada de la home, la que el dueño sube
 * desde `/admin/ajustes`. Separada de `productos/` para que un backup o una
 * limpieza del catálogo no se la lleve puesta.
 */
export function carpetaPortadas(): string {
  return `${folderPrefix()}portadas`;
}

/**
 * Carpeta **pública** del logo y el favicon de la tienda, los que el dueño
 * sube desde `/admin/ajustes` → Identidad.
 */
export function carpetaMarca(): string {
  return `${folderPrefix()}marca`;
}

/** Carpeta privada: comprobantes de pago, sólo accesibles vía URL firmada. */
export function carpetaComprobantes(): string {
  return `${folderPrefix()}comprobantes`;
}

/**
 * Genera una URL firmada de corta duración para un recurso privado
 * (comprobante de pago) en la carpeta `comprobantes/`. No expone el
 * recurso públicamente.
 */
export function signedReceiptUrl(
  publicId: string,
  { expiresInSeconds = 300 }: { expiresInSeconds?: number } = {},
): string {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  return configure().utils.private_download_url(publicId, "", {
    resource_type: "image",
    type: "authenticated",
    expires_at: expiresAt,
  });
}

/**
 * El SDK. Se configura solo en el primer acceso a cualquier propiedad, así que
 * quien lo usa no cambia nada: `cloudinary.uploader.upload(...)` sigue igual.
 */
export const cloudinary: typeof sdk = new Proxy(sdk, {
  get(target, prop, receiver) {
    configure();
    return Reflect.get(target, prop, receiver);
  },
});

/** Sólo para tests: obliga a reconfigurar en el próximo uso. */
export function resetCloudinaryConfigForTests(): void {
  aplicada = null;
}
