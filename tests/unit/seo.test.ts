import { readdir } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RUTAS_PRIVADAS,
  breadcrumbJsonLd,
  buildSitemap,
  itemListJsonLd,
  organizationJsonLd,
  productJsonLd,
  type MerchantPoliciesLd,
} from "../../src/lib/seo";

/**
 * SEO técnico.
 *
 * Tres cosas que fallan calladas y no se notan hasta ver el tráfico meses
 * después: un sitemap con URLs relativas (que ningún buscador acepta), un
 * `robots.txt` que deja pasar el crawler a `/pedido/<numero>` —el link
 * tokenizado que viaja por WhatsApp—, y un JSON-LD mal numerado en la
 * paginación.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("sitemap", () => {
  const input = {
    categories: [{ slug: "remeras" }, { slug: "pantalones" }],
    products: [
      { slug: "remera-azul", updatedAt: new Date("2026-01-15T00:00:00Z") },
      { slug: "jean-negro", updatedAt: null },
    ],
  };

  it("publica home, categorías y productos con URL absoluta", () => {
    const entries = buildSitemap(new URL("https://tienda.com.py"), input);

    expect(entries.map((entry) => entry.url)).toEqual([
      "https://tienda.com.py/",
      "https://tienda.com.py/categoria/remeras",
      "https://tienda.com.py/categoria/pantalones",
      "https://tienda.com.py/producto/remera-azul",
      "https://tienda.com.py/producto/jean-negro",
    ]);
  });

  it("usa el origen y descarta el path del NEXT_PUBLIC_SITE_URL", () => {
    const entries = buildSitemap(new URL("https://tienda.com.py/algo/"), input);

    expect(entries[0]!.url).toBe("https://tienda.com.py/");
  });

  it("no inventa una fecha para el producto que no la tiene", () => {
    const entries = buildSitemap(new URL("https://tienda.com.py"), input);
    const [conFecha, sinFecha] = entries.slice(-2);

    expect(conFecha!.lastModified).toEqual(new Date("2026-01-15T00:00:00Z"));
    expect(sinFecha).not.toHaveProperty("lastModified");
  });

  it("sin NEXT_PUBLIC_SITE_URL devuelve vacío en vez de URLs relativas", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const { default: sitemap } = await import("../../src/app/sitemap");

    await expect(sitemap()).resolves.toEqual([]);
  });
});

describe("robots.txt", () => {
  it("bloquea todas las rutas privadas", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda.com.py");
    const { default: robots } = await import("../../src/app/robots");

    const disallow = robots().rules;
    const reglas = Array.isArray(disallow) ? disallow[0]! : disallow;

    for (const ruta of RUTAS_PRIVADAS) {
      expect(reglas.disallow).toContain(`${ruta}/`);
      expect(reglas.disallow).toContain(`${ruta}$`);
      expect(reglas.disallow).toContain(`${ruta}?`);
    }
  });

  it("declara el sitemap sólo si hay origen público", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda.com.py");
    const conOrigen = (await import("../../src/app/robots")).default();
    expect(conOrigen.sitemap).toBe("https://tienda.com.py/sitemap.xml");

    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const sinOrigen = (await import("../../src/app/robots")).default();
    expect(sinOrigen.sitemap).toBeUndefined();
  });

  /**
   * El guardarraíl que importa: una ruta de la vidriera que muestre datos de
   * un comprador y no esté en la lista se indexa en silencio. Si esto falla
   * por una ruta nueva, la pregunta no es "¿cómo lo hago pasar?" sino "¿esto
   * lo puede ver un buscador?".
   */
  it("cubre todas las rutas de nivel uno que no son públicas", async () => {
    // `feed.xml`: el catálogo para Google Merchant y Meta (src/lib/product-feed.ts),
    // los mismos datos públicos que las fichas.
    // Las páginas de políticas (`/admin/ajustes` → páginas): texto de la
    // tienda, sin datos de nadie, y justamente lo que Google tiene que leer.
    const publicas = new Set([
      "buscar",
      "categoria",
      "producto",
      "feed.xml",
      "envios",
      "devoluciones",
      "preguntas-frecuentes",
      "terminos",
      "privacidad",
      "contacto",
    ]);
    const raiz = path.join(process.cwd(), "src/app");
    const entries = await readdir(raiz, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || publicas.has(entry.name)) continue;
      // `src/app/actions` no es una ruta: son server actions, no páginas.
      if (!(await tieneRuta(path.join(raiz, entry.name)))) continue;
      expect(RUTAS_PRIVADAS).toContain(`/${entry.name}`);
    }
  });
});

async function tieneRuta(dir: string): Promise<boolean> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (await tieneRuta(path.join(dir, entry.name))) return true;
    } else if (entry.name === "page.tsx" || entry.name === "route.ts") {
      return true;
    }
  }
  return false;
}

describe("JSON-LD de categoría", () => {
  const origin = new URL("https://tienda.com.py");

  it("numera la miga de pan desde 1 y apunta a URLs absolutas", () => {
    const jsonLd = breadcrumbJsonLd(origin, [
      { name: "Inicio", path: "/" },
      { name: "Remeras", path: "/categoria/remeras" },
    ]) as { itemListElement: { position: number; item: string }[] };

    expect(jsonLd.itemListElement.map((step) => step.position)).toEqual([1, 2]);
    expect(jsonLd.itemListElement[1]!.item).toBe(
      "https://tienda.com.py/categoria/remeras"
    );
  });

  it("continúa la numeración en las páginas siguientes", () => {
    const jsonLd = itemListJsonLd(
      origin,
      [{ name: "Remera azul", slug: "remera-azul" }],
      {
        name: "Remeras",
        startPosition: 13,
      }
    ) as {
      numberOfItems: number;
      itemListElement: { position: number; url: string }[];
    };

    expect(jsonLd.numberOfItems).toBe(1);
    expect(jsonLd.itemListElement[0]!.position).toBe(13);
    expect(jsonLd.itemListElement[0]!.url).toBe(
      "https://tienda.com.py/producto/remera-azul"
    );
  });

  /** Sin origen, la URL relativa es válida: el buscador la resuelve sola. */
  it("sin origen público emite rutas relativas y no `undefined`", () => {
    const jsonLd = itemListJsonLd(null, [
      { name: "Remera azul", slug: "remera-azul" },
    ]) as {
      itemListElement: { url: string }[];
    };

    expect(jsonLd.itemListElement[0]!.url).toBe("/producto/remera-azul");
  });
});

describe("productJsonLd", () => {
  const base = {
    slug: "conjunto-encaje",
    name: "Conjunto de encaje",
    description: "Suave",
    brand: null,
    variants: [
      { sku: "CE-S", label: "S", pricePyg: 150_000, available: 3 },
      { sku: "CE-M", label: "M", pricePyg: 150_000, available: 0 },
    ],
  };

  it("lleva imagen, url y condición: sin eso Google no da rich result de producto", () => {
    const jsonLd = productJsonLd({
      ...base,
      origin: new URL("https://tienda.com.py"),
      images: ["https://res.cloudinary.com/x/image/upload/a.jpg"],
    }) as {
      image: string[];
      url: string;
      offers: Array<Record<string, unknown>>;
    };

    expect(jsonLd.image).toEqual([
      "https://res.cloudinary.com/x/image/upload/a.jpg",
    ]);
    expect(jsonLd.url).toBe("https://tienda.com.py/producto/conjunto-encaje");
    expect(jsonLd.offers[0]).toMatchObject({
      url: "https://tienda.com.py/producto/conjunto-encaje",
      itemCondition: "https://schema.org/NewCondition",
      availability: "https://schema.org/InStock",
      priceCurrency: "PYG",
    });
    expect(jsonLd.offers[1]?.availability).toBe(
      "https://schema.org/OutOfStock"
    );
  });

  it("sin foto ni dominio, omite los campos en vez de inventarlos", () => {
    const jsonLd = productJsonLd({ ...base, origin: null, images: [] });
    expect(jsonLd.image).toBeUndefined();
    expect(jsonLd.url).toBeUndefined();
  });
});

describe("productJsonLd · reseñas verificadas", () => {
  const base = {
    origin: new URL("https://tienda.com.py"),
    slug: "conjunto-encaje",
    name: "Conjunto de encaje",
    images: [],
    variants: [{ sku: "CE-S", label: "S", pricePyg: 150_000, available: 3 }],
  };

  // 22:30 del 14 de marzo en Asunción = 01:30 del 15 en UTC.
  const deNoche = new Date("2026-03-15T01:30:00.000Z");

  const resenas = Array.from({ length: 7 }, (_, index) => ({
    author: `Rosa ${String.fromCharCode(65 + index)}.`,
    rating: 5 - (index % 2),
    title: index === 0 ? "Hermoso" : null,
    body: `Me encantó, la tela es muy suave (${index}).`,
    date: deNoche,
  }));

  it("con reseñas aprobadas emite aggregateRating y hasta 5 Review", () => {
    const jsonLd = productJsonLd({
      ...base,
      rating: { average: 4.6, count: 12 },
      reviews: resenas,
    }) as {
      aggregateRating: Record<string, unknown>;
      review: Array<Record<string, unknown>>;
    };

    expect(jsonLd.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.6,
      reviewCount: 12,
      bestRating: 5,
      worstRating: 1,
    });
    expect(jsonLd.review).toHaveLength(5);
    expect(jsonLd.review[0]).toEqual({
      "@type": "Review",
      reviewRating: {
        "@type": "Rating",
        ratingValue: 5,
        bestRating: 5,
        worstRating: 1,
      },
      author: { "@type": "Person", name: "Rosa A." },
      // El día de Asunción, no el de UTC.
      datePublished: "2026-03-14",
      name: "Hermoso",
      reviewBody: "Me encantó, la tela es muy suave (0).",
    });
    // Sin título, sin `name`: no se inventa uno.
    expect(jsonLd.review[1]).not.toHaveProperty("name");
  });

  it("con cero reseñas no aparece ninguna de las dos claves", () => {
    const sinNada = productJsonLd(base);
    const conCero = productJsonLd({
      ...base,
      rating: { average: 0, count: 0 },
      reviews: [],
    });

    for (const jsonLd of [sinNada, conCero]) {
      expect(jsonLd).not.toHaveProperty("aggregateRating");
      expect(jsonLd).not.toHaveProperty("review");
    }
  });
});

describe("productJsonLd · envío y devoluciones (ajustes de la tienda)", () => {
  const base = {
    origin: new URL("https://tienda.com.py"),
    slug: "remera",
    name: "Remera",
    images: [],
    variants: [
      { sku: "R-S", label: "S", pricePyg: 90_000, available: 2 },
      { sku: "R-M", label: "M", pricePyg: 90_000, available: 1 },
    ],
  };

  const vacio: MerchantPoliciesLd = {
    handlingDaysMin: null,
    handlingDaysMax: null,
    transitDaysMin: null,
    transitDaysMax: null,
    shippingFromPyg: null,
    acceptsReturns: null,
    returnDays: null,
    returnFees: null,
    returnMethod: null,
  };

  const envio: MerchantPoliciesLd = {
    ...vacio,
    handlingDaysMin: 0,
    handlingDaysMax: 1,
    transitDaysMin: 1,
    transitDaysMax: 3,
    shippingFromPyg: 25_000,
  };

  type Offer = Record<string, unknown> & {
    shippingDetails?: Record<string, unknown>;
    hasMerchantReturnPolicy?: Record<string, unknown>;
  };
  const offers = (merchant: MerchantPoliciesLd): Offer[] =>
    (productJsonLd({ ...base, merchant }) as { offers: Offer[] }).offers;

  it("sin nada cargado no agrega ni envío ni política de devolución", () => {
    for (const offer of offers(vacio)) {
      expect(offer).not.toHaveProperty("shippingDetails");
      expect(offer).not.toHaveProperty("hasMerchantReturnPolicy");
    }
    // Y sin `merchant`, igual que antes de esta sección.
    const sin = productJsonLd(base) as { offers: Offer[] };
    expect(sin.offers[0]).not.toHaveProperty("shippingDetails");
  });

  it("con precio y los dos rangos, cada Offer lleva OfferShippingDetails en PYG a PY", () => {
    for (const offer of offers(envio)) {
      expect(offer.shippingDetails).toEqual({
        "@type": "OfferShippingDetails",
        shippingRate: {
          "@type": "MonetaryAmount",
          value: 25_000,
          currency: "PYG",
        },
        shippingDestination: { "@type": "DefinedRegion", addressCountry: "PY" },
        deliveryTime: {
          "@type": "ShippingDeliveryTime",
          handlingTime: {
            "@type": "QuantitativeValue",
            minValue: 0,
            maxValue: 1,
            unitCode: "DAY",
          },
          transitTime: {
            "@type": "QuantitativeValue",
            minValue: 1,
            maxValue: 3,
            unitCode: "DAY",
          },
        },
      });
    }
  });

  it("un envío a medias no se publica: falta un rango o falta el precio", () => {
    expect(offers({ ...envio, transitDaysMax: null })[0]).not.toHaveProperty(
      "shippingDetails"
    );
    expect(offers({ ...envio, shippingFromPyg: null })[0]).not.toHaveProperty(
      "shippingDetails"
    );
  });

  it("envío gratis (₲0) sí es un dato y se publica", () => {
    const [offer] = offers({ ...envio, shippingFromPyg: 0 });
    expect(offer?.shippingDetails).toMatchObject({
      shippingRate: { value: 0, currency: "PYG" },
    });
  });

  it("acepta devoluciones: ventana finita, días, costo y método", () => {
    const [offer] = offers({
      ...vacio,
      acceptsReturns: true,
      returnDays: 7,
      returnFees: "cliente",
      returnMethod: "envio",
    });
    expect(offer?.hasMerchantReturnPolicy).toEqual({
      "@type": "MerchantReturnPolicy",
      applicableCountry: "PY",
      returnPolicyCategory:
        "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 7,
      returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
      returnMethod: "https://schema.org/ReturnByMail",
    });
  });

  it("devolución gratis y en los dos lugares: FreeReturn y los dos métodos", () => {
    const [offer] = offers({
      ...vacio,
      acceptsReturns: true,
      returnDays: 30,
      returnFees: "gratis",
      returnMethod: "ambos",
    });
    expect(offer?.hasMerchantReturnPolicy).toMatchObject({
      returnFees: "https://schema.org/FreeReturn",
      returnMethod: [
        "https://schema.org/ReturnByMail",
        "https://schema.org/ReturnInStore",
      ],
    });
  });

  it("sin costo ni método cargados, esos campos se omiten", () => {
    const [offer] = offers({
      ...vacio,
      acceptsReturns: true,
      returnDays: 10,
      returnMethod: "local",
    });
    expect(offer?.hasMerchantReturnPolicy).not.toHaveProperty("returnFees");
    expect(offer?.hasMerchantReturnPolicy).toMatchObject({
      returnMethod: "https://schema.org/ReturnInStore",
    });
  });

  it("no acepta devoluciones: MerchantReturnNotPermitted, sin días", () => {
    const [offer] = offers({ ...vacio, acceptsReturns: false, returnDays: 7 });
    expect(offer?.hasMerchantReturnPolicy).toEqual({
      "@type": "MerchantReturnPolicy",
      applicableCountry: "PY",
      returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
    });
  });

  it("acepta devoluciones pero sin días: no inventa una ventana", () => {
    expect(offers({ ...vacio, acceptsReturns: true })[0]).not.toHaveProperty(
      "hasMerchantReturnPolicy"
    );
  });
});

describe("organizationJsonLd", () => {
  it("sin origen configurado no sale", () => {
    expect(organizationJsonLd({ origin: null, name: "Tienda" })).toBeNull();
  });

  it("con origen: nombre, url, contacto y redes", () => {
    expect(
      organizationJsonLd({
        origin: new URL("https://tienda.com.py/algo"),
        name: "Tienda",
        telephone: "+595981123456",
        email: "hola@tienda.com.py",
        sameAs: ["https://instagram.com/tienda"],
      })
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Tienda",
      url: "https://tienda.com.py/",
      email: "hola@tienda.com.py",
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer service",
        telephone: "+595981123456",
        email: "hola@tienda.com.py",
        areaServed: "PY",
      },
      sameAs: ["https://instagram.com/tienda"],
    });
  });

  it("sin teléfono ni email ni redes, sólo nombre y url", () => {
    const jsonLd = organizationJsonLd({
      origin: new URL("https://tienda.com.py"),
      name: "Tienda",
    });
    expect(jsonLd).not.toHaveProperty("contactPoint");
    expect(jsonLd).not.toHaveProperty("sameAs");
    expect(jsonLd).not.toHaveProperty("email");
  });
});

describe("sitemap · páginas de políticas", () => {
  it("suma las páginas prendidas con URL absoluta", () => {
    const entries = buildSitemap(new URL("https://tienda.com.py"), {
      categories: [],
      products: [],
      pages: ["envios", "terminos"],
    });
    expect(entries.map((entry) => entry.url)).toEqual([
      "https://tienda.com.py/",
      "https://tienda.com.py/envios",
      "https://tienda.com.py/terminos",
    ]);
  });
});
