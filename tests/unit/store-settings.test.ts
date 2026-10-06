import { describe, expect, it } from "vitest";

import { PAGINAS_DEFAULT } from "@/config/paginas-default";
import { TIENDA, type Hero } from "@/config/tienda";
import {
  DEFAULT_STORE_SETTINGS,
  PAGINAS,
  SECTION_INPUT,
  StoreSettingsSchema,
  contactoEfectivo,
  heroEfectivo,
  lineasDeConfianza,
  linkSeguro,
  parseStoreSettings,
  umbralStockBajo,
} from "@/domain/store-settings-schema";
import { renderMarkdown } from "@/lib/markdown";
import {
  PLACEHOLDERS,
  listaConY,
  reemplazarPlaceholders,
} from "@/lib/placeholders";

/**
 * Ajustes de la tienda, la parte pura: el schema de lectura (que nunca tira),
 * el de escritura (que habla con el dueño), la precedencia contra
 * `tienda.ts`/entorno y los `{{…}}` de las páginas de políticas. Lo que toca
 * la base está en `tests/integration/store-settings.test.ts`.
 */

describe("StoreSettingsSchema: lectura", () => {
  it("`{}` da los defaults completos", () => {
    const ajustes = StoreSettingsSchema.parse({});
    expect(ajustes).toEqual(DEFAULT_STORE_SETTINGS);
    expect(ajustes.marca.heroActivo).toBe(true);
    expect(ajustes.marca.tagline).toBeNull();
    expect(ajustes.anuncio.activo).toBe(false);
    expect(ajustes.vidriera).toEqual({
      estrellasEnTarjetas: true,
      barraCompraMovil: true,
    });
    expect(ajustes.checkout.confianzaActiva).toBe(true);
    expect(ajustes.stock.umbralStockBajo).toBeNull();
    expect(ajustes.envioDevolucion.acceptsReturns).toBeNull();
    for (const slug of PAGINAS) {
      expect(ajustes.paginas[slug]).toEqual({
        activo: false,
        titulo: null,
        cuerpo: null,
      });
    }
  });

  it("un JSON parcial respeta lo que hay y completa el resto", () => {
    const ajustes = parseStoreSettings({
      contacto: { email: "hola@tienda.com.py" },
    });
    expect(ajustes.contacto.email).toBe("hola@tienda.com.py");
    expect(ajustes.contacto.whatsapp).toBeNull();
    expect(ajustes.marca).toEqual(DEFAULT_STORE_SETTINGS.marca);
  });

  it("un campo del tipo equivocado cae a su default sin llevarse a los demás", () => {
    const ajustes = parseStoreSettings({
      anuncio: { activo: "sí", texto: "Feriado" },
      vidriera: { estrellasEnTarjetas: false, barraCompraMovil: 3 },
      stock: "cualquier cosa",
    });
    expect(ajustes.anuncio).toEqual({
      activo: false,
      texto: "Feriado",
      href: null,
    });
    expect(ajustes.vidriera).toEqual({
      estrellasEnTarjetas: false,
      barraCompraMovil: true,
    });
    expect(ajustes.stock.umbralStockBajo).toBeNull();
  });

  it("string JSON (MariaDB), string roto, null o un array: nunca tira", () => {
    expect(
      parseStoreSettings('{"anuncio":{"activo":true,"texto":"Hola"}}').anuncio
        .texto
    ).toBe("Hola");
    expect(parseStoreSettings("{no es json")).toEqual(DEFAULT_STORE_SETTINGS);
    expect(parseStoreSettings(null)).toEqual(DEFAULT_STORE_SETTINGS);
    expect(parseStoreSettings([1, 2])).toEqual(DEFAULT_STORE_SETTINGS);
  });
});

describe("SECTION_INPUT: escritura", () => {
  it('vacío es "el de siempre" (null), y se recorta', () => {
    const marca = SECTION_INPUT.marca.parse({
      tagline: "  ",
      heroTitulo: "  Verano  ",
    });
    expect(marca.tagline).toBeNull();
    expect(marca.heroTitulo).toBe("Verano");
  });

  it("el WhatsApp se normaliza, y uno que no es paraguayo se rechaza", () => {
    expect(
      SECTION_INPUT.contacto.parse({ whatsapp: "0981 123 456" }).whatsapp
    ).toBe("+595981123456");
    expect(SECTION_INPUT.contacto.safeParse({ whatsapp: "12" }).success).toBe(
      false
    );
  });

  it("las redes sólo con https", () => {
    expect(
      SECTION_INPUT.contacto.safeParse({ instagram: "http://instagram.com/x" })
        .success
    ).toBe(false);
    expect(
      SECTION_INPUT.contacto.safeParse({ instagram: "javascript:alert(1)" })
        .success
    ).toBe(false);
    expect(
      SECTION_INPUT.contacto.parse({ instagram: "https://instagram.com/x" })
        .instagram
    ).toBe("https://instagram.com/x");
  });

  it("el link del botón: página interna o https, nunca `//otro.sitio`", () => {
    expect(
      SECTION_INPUT.marca.safeParse({ heroCtaHref: "/categoria/ofertas" })
        .success
    ).toBe(true);
    expect(
      SECTION_INPUT.marca.safeParse({ heroCtaHref: "//malo.com" }).success
    ).toBe(false);
    expect(
      SECTION_INPUT.anuncio.safeParse({ href: "javascript:alert(1)" }).success
    ).toBe(false);
  });

  it("la barra prendida exige texto, y el texto tiene tope", () => {
    expect(
      SECTION_INPUT.anuncio.safeParse({ activo: true, texto: "" }).success
    ).toBe(false);
    expect(
      SECTION_INPUT.anuncio.safeParse({ activo: true, texto: "x".repeat(141) })
        .success
    ).toBe(false);
  });

  it('días: min ≤ max, los dos o ninguno; "aceptás devoluciones" exige los días', () => {
    const ok = SECTION_INPUT.envioDevolucion.parse({
      handlingDaysMin: "0",
      handlingDaysMax: "2",
      shippingFromPyg: "25.000",
    });
    expect(ok).toMatchObject({
      handlingDaysMin: 0,
      handlingDaysMax: 2,
      shippingFromPyg: 25_000,
    });

    expect(
      SECTION_INPUT.envioDevolucion.safeParse({
        handlingDaysMin: "3",
        handlingDaysMax: "1",
      }).success
    ).toBe(false);
    expect(
      SECTION_INPUT.envioDevolucion.safeParse({ transitDaysMin: "1" }).success
    ).toBe(false);
    expect(
      SECTION_INPUT.envioDevolucion.safeParse({ acceptsReturns: true }).success
    ).toBe(false);
    expect(
      SECTION_INPUT.envioDevolucion.safeParse({ shippingFromPyg: "1,5" })
        .success
    ).toBe(false);
  });

  it("las líneas del checkout: vacías se van, sin ninguna vuelven las de siempre", () => {
    expect(
      SECTION_INPUT.checkout.parse({ confianzaLineas: ["Uno", "", " Dos "] })
        .confianzaLineas
    ).toEqual(["Uno", "Dos"]);
    expect(
      SECTION_INPUT.checkout.parse({ confianzaLineas: ["", ""] })
        .confianzaLineas
    ).toBeNull();
  });

  it("no acepta campos que no existen", () => {
    expect(SECTION_INPUT.vidriera.safeParse({ inventado: true }).success).toBe(
      false
    );
  });
});

describe("precedencia: ajuste → tienda.ts / entorno", () => {
  const base: Hero = {
    titulo: "Base",
    texto: "Texto base",
    cta: { label: "Ver", href: "/categoria/x" },
    imagen: { cloudinaryId: "portadas/base", alt: "Foto base" },
  };

  it("sin nada cargado, la portada es la base tal cual", () => {
    expect(heroEfectivo(DEFAULT_STORE_SETTINGS.marca, base)).toEqual(base);
  });

  it("cada campo cargado pisa sólo ése", () => {
    const hero = heroEfectivo(
      { ...DEFAULT_STORE_SETTINGS.marca, heroTitulo: "Verano" },
      base
    );
    expect(hero).toEqual({ ...base, titulo: "Verano" });

    const conFoto = heroEfectivo(
      { ...DEFAULT_STORE_SETTINGS.marca, heroImagenId: "portadas/nueva" },
      { titulo: "Sin foto" }
    );
    expect(conFoto?.imagen).toEqual({
      cloudinaryId: "portadas/nueva",
      alt: "Sin foto",
    });
  });

  it("apagada es null", () => {
    expect(
      heroEfectivo({ ...DEFAULT_STORE_SETTINGS.marca, heroActivo: false }, base)
    ).toBeNull();
  });

  it("el WhatsApp del panel gana; sin él, el del entorno", () => {
    expect(
      contactoEfectivo(DEFAULT_STORE_SETTINGS.contacto, "+595981000000")
        .whatsapp
    ).toBe("+595981000000");
    expect(
      contactoEfectivo(
        { ...DEFAULT_STORE_SETTINGS.contacto, whatsapp: "+595971111111" },
        "+595981000000"
      ).whatsapp
    ).toBe("+595971111111");
    expect(
      contactoEfectivo(DEFAULT_STORE_SETTINGS.contacto, null).whatsapp
    ).toBeNull();
  });

  it("el umbral de stock: el del panel (0 incluido) o el de siempre", () => {
    expect(umbralStockBajo({ umbralStockBajo: null }, 3)).toBe(3);
    expect(umbralStockBajo({ umbralStockBajo: 0 }, 3)).toBe(0);
    expect(umbralStockBajo({ umbralStockBajo: 10 }, 3)).toBe(10);
  });

  it("las líneas de confianza: las propias o las de siempre", () => {
    expect(lineasDeConfianza(DEFAULT_STORE_SETTINGS.checkout)).toHaveLength(3);
    expect(
      lineasDeConfianza({
        ...DEFAULT_STORE_SETTINGS.checkout,
        confianzaLineas: ["Sólo ésta"],
      })
    ).toEqual(["Sólo ésta"]);
  });

  it("la tagline por defecto sigue siendo la de tienda.ts", () => {
    expect(DEFAULT_STORE_SETTINGS.marca.tagline ?? TIENDA.tagline).toBe(
      TIENDA.tagline
    );
  });
});

describe("placeholders de las páginas", () => {
  it("reemplaza los que tienen valor", () => {
    expect(
      reemplazarPlaceholders("Escribinos: {{whatsapp}} · {{ email }}", {
        whatsapp: "(0981) 123-456",
        email: "hola@tienda.com.py",
      })
    ).toBe("Escribinos: (0981) 123-456 · hola@tienda.com.py");
  });

  it("sin valor sale una frase, nunca el `{{` crudo ni un hueco", () => {
    for (const nombre of PLACEHOLDERS) {
      const salida = reemplazarPlaceholders(`A: {{${nombre}}}.`, {
        [nombre]: "  ",
      });
      expect(salida).not.toContain("{{");
      expect(salida).not.toMatch(/A: \./);
      expect(salida.length).toBeGreaterThan("A: .".length + 3);
    }
  });

  it("un placeholder que no existe se borra en vez de mostrarse", () => {
    expect(reemplazarPlaceholders("Hola {{whatsap}}!", {})).toBe("Hola !");
  });

  it("ningún texto por defecto deja un `{{` sin resolver, con o sin datos", () => {
    const lleno = {
      tienda: "Tienda",
      url: "tienda.com.py",
      whatsapp: "(0981) 123-456",
      email: "hola@tienda.com.py",
      direccion: "Mcal. López 123",
      horario: "Lun a vie 8 a 18",
      diasDevolucion: "7 días",
      mediosDePago: listaConY(["Transferencia", "Contra entrega"]),
    };
    for (const slug of PAGINAS) {
      for (const valores of [{}, lleno]) {
        const texto = reemplazarPlaceholders(
          PAGINAS_DEFAULT[slug].cuerpo,
          valores
        );
        expect(texto, slug).not.toMatch(/\{\{|\}\}/);
        const html = renderMarkdown(texto);
        expect(html, slug).not.toMatch(/\{\{|\}\}/);
        expect(html, slug).toContain("<p>");
      }
    }
  });

  it("los textos por defecto no nombran la tienda a mano", () => {
    for (const slug of PAGINAS) {
      // The merchant name also means the generic catalog noun in Spanish.
      expect(PAGINAS_DEFAULT[slug].cuerpo).not.toContain(TIENDA.nombre);
    }
  });

  it("listaConY", () => {
    expect(listaConY([])).toBe("");
    expect(listaConY(["a"])).toBe("a");
    expect(listaConY(["a", "b", "c"])).toBe("a, b y c");
  });
});

describe("links leídos de la base", () => {
  it("un `javascript:` editado a mano no llega a un href", () => {
    const contacto = contactoEfectivo(
      {
        ...DEFAULT_STORE_SETTINGS.contacto,
        instagram: "javascript:alert(1)",
        facebook: "https://facebook.com/x",
      },
      null
    );
    expect(contacto.redes).toEqual([
      { red: "facebook", url: "https://facebook.com/x" },
    ]);
    expect(linkSeguro("javascript:alert(1)")).toBeNull();
    expect(linkSeguro("//malo.com")).toBeNull();
    expect(linkSeguro("/categoria/x")).toBe("/categoria/x");
    expect(
      heroEfectivo(
        { ...DEFAULT_STORE_SETTINGS.marca, heroCtaHref: "javascript:alert(1)" },
        { titulo: "x", cta: { label: "Ver", href: "/categoria/y" } }
      )?.cta
    ).toEqual({ label: "Ver", href: "/categoria/y" });
  });
});
