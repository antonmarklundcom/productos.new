/**
 * El feed de productos (`/feed.xml`) para Google Merchant Center y el
 * catálogo de Meta (Commerce Manager): RSS 2.0 con los campos `g:`, que los
 * dos leen.
 *
 * Con el feed cargado, cada producto puede salir gratis en Google Shopping
 * ("fichas gratuitas") y el catálogo de Meta habilita los anuncios de
 * catálogo y las etiquetas de compra de Instagram — sin cargar un producto a
 * mano en ningún lado.
 *
 * Un ítem por **variante** (así lo pide Google: talle y color son ítems con
 * el mismo `item_group_id`). Lo que no se puede dar bien no se da: sin foto
 * no hay ítem (Google lo rechaza entero), y sin marca va
 * `identifier_exists=no` en vez de inventar una.
 *
 * Puro, sin base ni entorno: lo arma `src/app/feed.xml/route.ts`.
 */

export type FeedProduct = {
  slug: string;
  name: string;
  description: string;
  brand: string | null;
  categoryName: string;
  /** URLs absolutas, en orden; la primera es la principal. */
  images: string[];
  variants: {
    sku: string;
    label: string;
    pricePyg: number;
    compareAtPyg: number | null;
    available: number;
  }[];
};

export type FeedInput = {
  origin: URL;
  tienda: { nombre: string; descripcion: string };
  products: FeedProduct[];
};

/** Google corta `title` a 150 y `description` a 5000. */
const TITLE_MAX = 150;
const DESCRIPTION_MAX = 5000;
/** `additional_image_link` acepta hasta 10. */
const ADDITIONAL_IMAGES_MAX = 10;

export function escapeXml(texto: string): string {
  return texto
    // Caracteres de control que XML 1.0 no admite ni escapados.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function recortar(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1).trimEnd()}…` : limpio;
}

/** Guaraníes enteros: PYG no tiene decimales. */
function precio(pyg: number): string {
  return `${pyg} PYG`;
}

function tag(nombre: string, valor: string): string {
  return `<${nombre}>${escapeXml(valor)}</${nombre}>`;
}

function item(origin: URL, product: FeedProduct, variant: FeedProduct["variants"][number]): string {
  const varias = product.variants.length > 1;
  const titulo = varias ? `${product.name} — ${variant.label}` : product.name;
  const enOferta = variant.compareAtPyg !== null && variant.compareAtPyg > variant.pricePyg;
  const [principal, ...resto] = product.images;

  const campos = [
    tag("g:id", variant.sku),
    varias ? tag("g:item_group_id", product.slug) : null,
    tag("title", recortar(titulo, TITLE_MAX)),
    tag("description", recortar(product.description || product.name, DESCRIPTION_MAX)),
    tag("link", `${origin.origin}/producto/${product.slug}`),
    tag("g:image_link", principal ?? ""),
    ...resto.slice(0, ADDITIONAL_IMAGES_MAX).map((src) => tag("g:additional_image_link", src)),
    tag("g:availability", variant.available > 0 ? "in_stock" : "out_of_stock"),
    // Con precio "antes", `price` es el de lista y `sale_price` el que se
    // cobra: así Google muestra el tachado igual que la ficha.
    tag("g:price", precio(enOferta ? variant.compareAtPyg! : variant.pricePyg)),
    enOferta ? tag("g:sale_price", precio(variant.pricePyg)) : null,
    tag("g:condition", "new"),
    product.brand ? tag("g:brand", product.brand) : tag("g:identifier_exists", "no"),
    tag("g:product_type", product.categoryName),
  ];

  return `<item>${campos.filter((campo) => campo !== null).join("")}</item>`;
}

export function buildProductFeed(input: FeedInput): string {
  const items = input.products
    .filter((product) => product.images.length > 0)
    .flatMap((product) => product.variants.map((variant) => item(input.origin, product, variant)));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "<channel>",
    tag("title", input.tienda.nombre),
    tag("link", input.origin.origin),
    tag("description", input.tienda.descripcion),
    ...items,
    "</channel>",
    "</rss>",
  ].join("\n");
}
