/**
 * Piezas de SEO técnico: qué se le deja ver a un buscador y qué no.
 *
 * Está en `lib/` y no dentro de las rutas porque son decisiones que no
 * queremos redecidir por tienda: las rutas privadas se bloquean igual en
 * todas, y el JSON-LD tiene que salir con la misma forma en la vidriera
 * entera. Las rutas (`sitemap.ts`, `robots.ts`, la categoría) sólo traen los
 * datos y llaman acá, así que esto se testea sin levantar Next ni la base.
 */

import { formatDatePY } from "./py";

/**
 * Lo que ningún buscador debería recorrer.
 *
 * No es seguridad —los guards son la defensa real— sino higiene: `/admin` y
 * `/api` no tienen nada que indexar, y `/checkout`, `/pedido` y `/cuenta`
 * llevan datos de una compra concreta. `/pedido/<numero>` en particular es un
 * link tokenizado que viaja por WhatsApp: aparecer en un índice sería
 * filtrarlo. `/favoritos` es distinta para cada navegador —localStorage, o
 * una lista compartida por `?p=`— y no tiene nada propio que Google deba
 * guardar.
 */
export const RUTAS_PRIVADAS = [
  "/admin",
  "/api",
  "/checkout",
  "/pedido",
  "/cuenta",
  "/dev",
  "/favoritos",
  // La configuración inicial (sólo existe con SETUP_SECRET puesto).
  "/setup",
] as const;

export type SitemapEntry = {
  url: string;
  lastModified?: Date;
  changeFrequency?:
    "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
};

export type SitemapInput = {
  categories: { slug: string }[];
  products: { slug: string; updatedAt: Date | null }[];
  /** Las páginas de políticas prendidas (`/envios`, `/terminos`…), por slug. */
  pages?: string[];
};

/**
 * El JSON-LD listo para meter en un `<script type="application/ld+json">`.
 *
 * `JSON.stringify` a secas **no alcanza**: no escapa `<`, así que un nombre de
 * producto que contenga `</script>` cierra la etiqueta antes de tiempo y lo
 * que venga después lo parsea el navegador como HTML. El texto del catálogo lo
 * escribe gente del panel, no un extraño, pero "sólo lo toca gente de
 * confianza" es exactamente la suposición que convierte un typo en un XSS
 * almacenado — y en la home y las categorías, que se cachean, el CSP ya no
 * lleva nonce para atajarlo.
 *
 * Escapar `<` y `>` como `\u003c`/`\u003e` es válido en JSON y en JS: el
 * consumidor lee exactamente el mismo string, y ninguna etiqueta puede
 * cerrarse desde adentro. `&` va por el mismo camino para no dejar entidades a
 * medio interpretar.
 */
export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * El sitemap completo, a partir del origen público y del catálogo activo.
 *
 * `origin` es `NEXT_PUBLIC_SITE_URL` (ver `lib/site-url.ts`). Sin esa variable
 * no hay sitemap: una URL relativa no le sirve a nadie y un dominio inventado
 * es peor que no publicar nada. El llamador devuelve la lista vacía y listo.
 */
export function buildSitemap(origin: URL, input: SitemapInput): SitemapEntry[] {
  const base = origin.origin;

  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    ...input.categories.map((category) => ({
      url: `${base}/categoria/${category.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...input.products.map((product) => ({
      url: `${base}/producto/${product.slug}`,
      ...(product.updatedAt ? { lastModified: product.updatedAt } : {}),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...(input.pages ?? []).map((slug) => ({
      url: `${base}/${slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.3,
    })),
  ];
}

type JsonLd = Record<string, unknown>;

/**
 * `BreadcrumbList` — la miga de pan que ya se dibuja arriba de la página,
 * dicha en el idioma de Google. Las posiciones arrancan en 1 por spec.
 */
export function breadcrumbJsonLd(
  origin: URL | null,
  trail: { name: string; path: string }[]
): JsonLd {
  const base = origin?.origin ?? "";
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: `${base}${step.path}`,
    })),
  };
}

/**
 * `ItemList` de una categoría: qué productos hay y en qué orden.
 *
 * Sin precios ni disponibilidad a propósito — eso vive en el `Product` de la
 * ficha, que es la única página que lo tiene fresco (`force-dynamic`). Repetir
 * un precio acá, con ISR de cinco minutos, es prometer un dato viejo.
 */
export function itemListJsonLd(
  origin: URL | null,
  items: { name: string; slug: string }[],
  options: { name?: string; startPosition?: number } = {}
): JsonLd {
  const base = origin?.origin ?? "";
  const start = options.startPosition ?? 1;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    ...(options.name ? { name: options.name } : {}),
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: start + index,
      name: item.name,
      url: `${base}/producto/${item.slug}`,
    })),
  };
}

/**
 * `Product` de la ficha. Sin `image` Google no da rich result de producto ni
 * listado de comercio, y sin `url` cada `Offer` queda sin página a la que
 * mandar. Lo que no hay no se inventa: sin foto o sin dominio configurado, el
 * campo se omite (mejor que una URL rota en el rich result).
 */
export function productJsonLd(input: {
  origin: URL | null;
  slug: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  /** URLs absolutas de las fotos (Cloudinary), en orden. */
  images: string[];
  variants: {
    sku: string;
    label: string;
    pricePyg: number;
    available: number;
  }[];
  saleMode?: "stock" | "enquiry" | "showcase";
  showPrice?: boolean;
  /**
   * Promedio y cantidad de reseñas **aprobadas** (`getProductRatingSummary`).
   * Con `count` 0 o ausente no sale ni `aggregateRating` ni `review`: un
   * `aggregateRating` con cero reseñas es un error de datos estructurados.
   */
  rating?: { average: number; count: number };
  /** Las aprobadas más nuevas primero; se publican las 5 primeras. */
  reviews?: ProductReviewLd[];
  /**
   * Envío y devoluciones, tal como los cargó el dueño en `/admin/ajustes`
   * (sección "Envíos y devoluciones"). Lo que falta no se inventa: ver
   * `offerShippingLd` y `returnPolicyLd`.
   */
  merchant?: MerchantPoliciesLd;
}): JsonLd {
  const url = input.origin
    ? `${input.origin.origin}/producto/${input.slug}`
    : undefined;
  const conResenas = input.rating !== undefined && input.rating.count >= 1;
  const shippingDetails = input.merchant
    ? offerShippingLd(input.merchant)
    : null;
  const returnPolicy = input.merchant ? returnPolicyLd(input.merchant) : null;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    description: input.description || undefined,
    image: input.images.length > 0 ? input.images : undefined,
    url,
    brand: input.brand ? { "@type": "Brand", name: input.brand } : undefined,
    sku: input.variants[0]?.sku,
    offers:
      (input.saleMode === undefined || input.saleMode === "stock") &&
      input.showPrice !== false
        ? input.variants.map((variant) => ({
            "@type": "Offer",
            sku: variant.sku,
            name: variant.label,
            price: variant.pricePyg,
            priceCurrency: "PYG",
            itemCondition: "https://schema.org/NewCondition",
            url,
            availability:
              variant.available > 0
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
            ...(shippingDetails ? { shippingDetails } : {}),
            ...(returnPolicy ? { hasMerchantReturnPolicy: returnPolicy } : {}),
          }))
        : undefined,
    ...(conResenas && input.rating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: input.rating.average,
            reviewCount: input.rating.count,
            bestRating: 5,
            worstRating: 1,
          },
          ...(input.reviews && input.reviews.length > 0
            ? { review: input.reviews.slice(0, MAX_REVIEWS_LD).map(reviewLd) }
            : {}),
        }
      : {}),
  };
}

/** Una reseña aprobada, como la necesita el JSON-LD. */
export type ProductReviewLd = {
  /** El "Nombre I." ya guardado en la reseña, nunca el nombre completo. */
  author: string;
  rating: number;
  title?: string | null;
  body: string;
  date: Date;
};

/** Cuántas reseñas van en el JSON-LD. El resto está en la página, no hace falta repetirlo. */
const MAX_REVIEWS_LD = 5;

function reviewLd(review: ProductReviewLd): JsonLd {
  return {
    "@type": "Review",
    reviewRating: {
      "@type": "Rating",
      ratingValue: review.rating,
      bestRating: 5,
      worstRating: 1,
    },
    author: { "@type": "Person", name: review.author },
    datePublished: isoDatePY(review.date),
    ...(review.title ? { name: review.title } : {}),
    reviewBody: review.body,
  };
}

/** `YYYY-MM-DD` del día paraguayo: la reseña de las 22:00 es de ese día y no del siguiente en UTC. */
function isoDatePY(date: Date): string {
  const [dia, mes, anio] = formatDatePY(date).split("/");
  return `${anio}-${mes}-${dia}`;
}

/**
 * Los datos de envío y devolución que Google pide en cada `Offer` (Merchant
 * listings). Todos opcionales: `null` = el dueño no lo cargó.
 */
export type MerchantPoliciesLd = {
  handlingDaysMin: number | null;
  handlingDaysMax: number | null;
  transitDaysMin: number | null;
  transitDaysMax: number | null;
  shippingFromPyg: number | null;
  acceptsReturns: boolean | null;
  returnDays: number | null;
  returnFees: "cliente" | "gratis" | null;
  returnMethod: "envio" | "local" | "ambos" | null;
};

/**
 * `OfferShippingDetails`, **sólo** con el precio "desde" y los dos rangos de
 * días completos. Un envío a medias (precio sin plazos) Google lo marca como
 * error, y un plazo inventado es una promesa que la tienda no hizo.
 */
export function offerShippingLd(m: MerchantPoliciesLd): JsonLd | null {
  const completo =
    m.shippingFromPyg !== null &&
    m.handlingDaysMin !== null &&
    m.handlingDaysMax !== null &&
    m.transitDaysMin !== null &&
    m.transitDaysMax !== null;
  if (!completo) return null;

  return {
    "@type": "OfferShippingDetails",
    shippingRate: {
      "@type": "MonetaryAmount",
      value: m.shippingFromPyg,
      currency: "PYG",
    },
    shippingDestination: { "@type": "DefinedRegion", addressCountry: "PY" },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: {
        "@type": "QuantitativeValue",
        minValue: m.handlingDaysMin,
        maxValue: m.handlingDaysMax,
        unitCode: "DAY",
      },
      transitTime: {
        "@type": "QuantitativeValue",
        minValue: m.transitDaysMin,
        maxValue: m.transitDaysMax,
        unitCode: "DAY",
      },
    },
  };
}

/**
 * `MerchantReturnPolicy`, **sólo** si el dueño contestó "¿aceptás
 * devoluciones?". Con "sí" hace falta la cantidad de días: sin ella no hay
 * ventana que publicar y se omite entera antes que inventar una.
 */
export function returnPolicyLd(m: MerchantPoliciesLd): JsonLd | null {
  if (m.acceptsReturns === null) return null;

  if (m.acceptsReturns === false) {
    return {
      "@type": "MerchantReturnPolicy",
      applicableCountry: "PY",
      returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
    };
  }

  if (m.returnDays === null || m.returnDays <= 0) return null;

  const metodos = {
    envio: "https://schema.org/ReturnByMail",
    local: "https://schema.org/ReturnInStore",
  } as const;

  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: "PY",
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: m.returnDays,
    ...(m.returnFees === "gratis"
      ? { returnFees: "https://schema.org/FreeReturn" }
      : m.returnFees === "cliente"
        ? { returnFees: "https://schema.org/ReturnFeesCustomerResponsibility" }
        : {}),
    ...(m.returnMethod === "ambos"
      ? { returnMethod: [metodos.envio, metodos.local] }
      : m.returnMethod
        ? { returnMethod: metodos[m.returnMethod] }
        : {}),
  };
}

/**
 * `Organization` de la home: quién es la tienda y cómo contactarla. Sin
 * origen configurado **no sale**: `url` es lo que identifica a la
 * organización, y un JSON-LD sin ella (o con un dominio adivinado) es peor
 * que ninguno. Mismo criterio que la `url` de `productJsonLd`.
 */
export function organizationJsonLd(input: {
  origin: URL | null;
  name: string;
  /** Ya normalizado (`+595…`). */
  telephone?: string | null;
  email?: string | null;
  /** Perfiles de redes (`https://…`). */
  sameAs?: string[];
}): JsonLd | null {
  if (!input.origin) return null;

  const contacto =
    input.telephone || input.email
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer service",
            ...(input.telephone ? { telephone: input.telephone } : {}),
            ...(input.email ? { email: input.email } : {}),
            areaServed: "PY",
          },
        }
      : {};

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    url: `${input.origin.origin}/`,
    ...(input.email ? { email: input.email } : {}),
    ...contacto,
    ...(input.sameAs && input.sameAs.length > 0
      ? { sameAs: input.sameAs }
      : {}),
  };
}
