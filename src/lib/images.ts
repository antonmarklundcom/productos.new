/**
 * URLs de entrega de imágenes públicas de producto.
 *
 * A propósito NO importa `src/lib/cloudinary.ts`: ese módulo configura el SDK
 * con el api_secret y explota al importarse si falta una variable. Armar una
 * URL de entrega pública no necesita ningún secreto, y la vidriera no puede
 * caerse porque el comercio todavía no cargó las credenciales.
 */


/** Lo registra `src/lib/integraciones.ts` al cargarse (ver `cloudName`). */
const LECTOR_CLOUD_NAME = Symbol.for("ecom.integraciones.cloudName");

/**
 * El `cloud_name`, panel > entorno (src/lib/integraciones.ts). Se lee en cada
 * llamada: el dueño lo puede cargar desde el panel sin redeploy.
 *
 * **No importa `integraciones.ts`**, a propósito: este archivo lo usan
 * componentes cliente, y ese módulo (con la tabla de campos de todas las
 * integraciones) inflaba el JS de la home por encima del presupuesto de
 * `tests/e2e/presupuesto.spec.ts`. En el servidor, `integraciones.ts` deja un
 * lector en `globalThis` al cargarse (lo carga `instrumentation.ts` al
 * arrancar); sin él, el entorno de siempre. En el navegador no hay ni lector
 * ni entorno y da `null`, como siempre.
 */
function cloudName(): string | null {
  const lector = (globalThis as { [LECTOR_CLOUD_NAME]?: () => string | null })[LECTOR_CLOUD_NAME];
  if (lector) return lector();
  if (typeof process === "undefined") return null;
  return (process.env.CLOUDINARY_CLOUD_NAME ?? "").trim() || null;
}

/** Transformaciones por defecto: formato y calidad los decide Cloudinary. */
const DEFAULT_TRANSFORMS = "f_auto,q_auto";

export type ImageSize = "thumb" | "card" | "detail" | "og" | "hero" | "qr" | "logo" | "favicon";

/**
 * 1200×630 es la caja que esperan WhatsApp, Instagram y Facebook. `c_fill` y
 * no `c_fit`: una foto cuadrada metida en un lienzo 1.91:1 sale con dos
 * franjas vacías a los costados, y en la previsualización del chat eso se ve
 * como un error del comercio.
 */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

const SIZE_TRANSFORMS: Record<ImageSize, string> = {
  thumb: "c_fill,w_160,h_160",
  card: "c_fill,w_600,h_600",
  detail: "c_fit,w_1200,h_1200",
  og: `c_fill,w_${OG_IMAGE_SIZE.width},h_${OG_IMAGE_SIZE.height}`,
  /**
   * La portada de la home (PR O). Ancha y baja, y con `c_fill` para que una
   * foto vertical no salga con franjas: es la primera pantalla y ahí una
   * imagen deformada o con bordes vacíos se lee como tienda descuidada.
   *
   * 1600 de ancho y no 2400: el techo real de este template es una pantalla de
   * escritorio común, y en el celular paraguayo cada 100 kB de portada son
   * segundos antes de ver un producto (ARCH.md §6).
   */
  hero: "c_fill,w_1600,h_600",
  /**
   * El QR del SPI (PR T). `c_fit` y no `c_fill`: recortar un QR lo rompe —
   * deja de escanear— y ahí no hay "se ve un poco mal", hay una compradora
   * parada frente a la app del banco que no puede pagar.
   */
  qr: "c_fit,w_600,h_600",
  /**
   * El logo del header (`/admin/ajustes` → Identidad). `c_fit` para no
   * recortar un logo apaisado; 96 de alto alcanza para el doble de densidad
   * del header (h-8/h-10).
   */
  logo: "c_fit,h_96,w_480",
  /** El favicon: cuadrado, chico, recortado al centro. */
  favicon: "c_fill,w_64,h_64",
};

/**
 * `productImageUrl("productos/remera-azul", "card")`.
 * Devuelve `null` si no hay cloud configurado o el id está vacío — quien
 * llama muestra el placeholder.
 */
export function productImageUrl(
  cloudinaryId: string | null | undefined,
  size: ImageSize = "card"
): string | null {
  const cloud = cloudName();
  if (!cloud || !cloudinaryId) return null;
  const transforms = `${DEFAULT_TRANSFORMS},${SIZE_TRANSFORMS[size]}`;
  return `https://res.cloudinary.com/${cloud}/image/upload/${transforms}/${cloudinaryId}`;
}

/**
 * Ilustraciones placeholder commiteadas (`public/placeholders/`), una por
 * categoría del seed — evita que la demo se muestre con cajas de color liso
 * antes de que el comercio cargue fotos reales. A propósito son dibujos de
 * línea simples y genéricos, sin logos de marca: son un "todavía no hay
 * foto", no un producto de mentira disfrazado de real.
 */
const CATEGORY_PLACEHOLDERS = new Set([
  "electronica",
  "hogar-y-cocina",
  "moda",
  "deportes",
]);

/** `categoryPlaceholderSrc("moda")` → `/placeholders/moda.svg`. */
export function categoryPlaceholderSrc(categorySlug: string): string {
  const slug = CATEGORY_PLACEHOLDERS.has(categorySlug) ? categorySlug : "generico";
  return `/placeholders/${slug}.svg`;
}

/**
 * El QR SPI del comercio, subido desde `/admin/banco` (PLAN.md FASE 2, PR T).
 *
 * Es la misma URL pública de siempre con la transformación `qr`; existe como
 * función propia para que quien la lee no tenga que acordarse de pasar el
 * tamaño correcto, que en un QR no es cosmético (ver arriba).
 */
export function bankQrUrl(cloudinaryId: string | null | undefined): string | null {
  return productImageUrl(cloudinaryId, "qr");
}
