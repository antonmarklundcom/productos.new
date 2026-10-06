import { z } from "zod";

import type { Hero } from "@/config/tienda";
import { t } from "@/i18n";
import { normalizePhonePY } from "@/lib/py";

/**
 * Los ajustes de la tienda (`store_settings.data`): la forma, los defaults y
 * las reglas de precedencia. **Puro**: sin base, sin Next, sin `process.env`,
 * así lo pueden importar los formularios del panel (`import type`), los tests
 * unitarios y `store-settings.ts`, que es el que lee y escribe la fila.
 *
 * ### Dos schemas por sección, y por qué
 *
 * - **El de lectura** (`StoreSettingsSchema`) no rechaza nunca. Cada campo
 *   tiene su default con `.catch()`, así que `{}`, un JSON de una versión
 *   vieja del template o una fila editada a mano con un campo del tipo
 *   equivocado se leen igual: lo que no sirve cae a su default y el resto se
 *   respeta. La vidriera no se puede caer por un ajuste.
 * - **El de escritura** (`SECTION_INPUT`) es estricto y habla con el dueño:
 *   largo máximo, links `https://`, el WhatsApp con la forma paraguaya. Lo
 *   corre el dominio antes de guardar, nunca la vidriera.
 *
 * ### `null` = "el de siempre"
 *
 * Un texto en `null` no es "vacío": es "usá lo que dice `src/config/tienda.ts`
 * o el entorno". Así una tienda que nunca abrió `/admin/ajustes` se ve
 * exactamente igual que antes de que existiera, y "Restaurar valores por
 * defecto" es simplemente volver a `null`.
 */

// ---------------------------------------------------------------------------
// Lectura: nunca tira
// ---------------------------------------------------------------------------

const texto = z.string().nullable().catch(null);
const entero = z.number().int().nullable().catch(null);
const interruptor = (porDefecto: boolean) => z.boolean().catch(porDefecto);

/** Un objeto que, si llega roto entero, vale lo mismo que `{}`. */
function seccion<Forma extends z.ZodRawShape>(forma: Forma) {
  const schema = z.object(forma);
  return schema.catch(() => schema.parse({}));
}

export const PAGINAS = [
  "envios",
  "devoluciones",
  "preguntas-frecuentes",
  "terminos",
  "privacidad",
] as const;
export type PaginaSlug = (typeof PAGINAS)[number];

export function isPaginaSlug(value: string): value is PaginaSlug {
  return (PAGINAS as readonly string[]).includes(value);
}

const RETURN_FEES = ["cliente", "gratis"] as const;
const RETURN_METHODS = ["envio", "local", "ambos"] as const;
export type ReturnFees = (typeof RETURN_FEES)[number];
export type ReturnMethod = (typeof RETURN_METHODS)[number];

const PaginaSchema = seccion({
  activo: interruptor(false),
  titulo: texto,
  /** `null` = el texto por defecto de `src/config/paginas-default.ts`. */
  cuerpo: texto,
});

export const StoreSettingsSchema = z.object({
  /**
   * La identidad de la tienda: nombre, logo, favicon y color de marca. Todo
   * `null` = lo de `src/config/tienda.ts` y el tema de `globals.css`, como
   * antes de que existiera esta sección.
   */
  identidad: seccion({
    nombre: texto,
    /** `public_id` en la carpeta pública `marca/` de Cloudinary. */
    logoId: texto,
    faviconId: texto,
    /** `#RRGGBB`. Pisa `--primary` del tema; el texto encima se elige solo. */
    colorPrimario: texto,
  }),
  /**
   * Cuentas de cliente. `null` = lo que dice `TIENDA.cuentasClientes`.
   */
  cuentas: seccion({
    activas: z.boolean().nullable().catch(null),
  }),
  marca: seccion({
    tagline: texto,
    seoTitulo: texto,
    seoDescripcion: texto,
    heroActivo: interruptor(true),
    heroTitulo: texto,
    heroTexto: texto,
    heroCtaLabel: texto,
    heroCtaHref: texto,
    heroImagenId: texto,
    heroImagenAlt: texto,
  }),
  anuncio: seccion({
    activo: interruptor(false),
    texto,
    href: texto,
  }),
  contacto: seccion({
    /** Ya normalizado (`+595…`). `null` = `WHATSAPP_NUMBER` del entorno. */
    whatsapp: texto,
    email: texto,
    direccion: texto,
    horario: texto,
    instagram: texto,
    facebook: texto,
    tiktok: texto,
  }),
  envioDevolucion: seccion({
    handlingDaysMin: entero,
    handlingDaysMax: entero,
    transitDaysMin: entero,
    transitDaysMax: entero,
    shippingFromPyg: entero,
    acceptsReturns: z.boolean().nullable().catch(null),
    returnDays: entero,
    returnFees: z.enum(RETURN_FEES).nullable().catch(null),
    returnMethod: z.enum(RETURN_METHODS).nullable().catch(null),
  }),
  paginas: seccion({
    envios: PaginaSchema,
    devoluciones: PaginaSchema,
    "preguntas-frecuentes": PaginaSchema,
    terminos: PaginaSchema,
    privacidad: PaginaSchema,
  }),
  vidriera: seccion({
    estrellasEnTarjetas: interruptor(true),
    barraCompraMovil: interruptor(true),
  }),
  checkout: seccion({
    confianzaActiva: interruptor(true),
    confianzaTitulo: texto,
    confianzaLineas: z.array(z.string()).max(4).nullable().catch(null),
  }),
  stock: seccion({
    /** `null` = `DEFAULT_REORDER_POINT`. El de cada variante igual gana. */
    umbralStockBajo: entero,
  }),
});

export type StoreSettings = z.infer<typeof StoreSettingsSchema>;
export type StoreSettingsSection = keyof StoreSettings;
export const STORE_SETTINGS_SECTIONS = Object.keys(
  StoreSettingsSchema.shape
) as StoreSettingsSection[];

export function isStoreSettingsSection(
  value: string
): value is StoreSettingsSection {
  return (STORE_SETTINGS_SECTIONS as string[]).includes(value);
}

/**
 * Cualquier cosa → ajustes completos. Acepta el JSON ya parseado (MySQL 8) o
 * como string (MariaDB guarda `JSON` como `LONGTEXT` y drizzle no lo parsea).
 * Un string que no es JSON cuenta como `{}`: todo default.
 */
export function parseStoreSettings(raw: unknown): StoreSettings {
  let valor = raw;
  if (typeof valor === "string") {
    try {
      valor = JSON.parse(valor);
    } catch {
      valor = {};
    }
  }
  if (valor === null || typeof valor !== "object" || Array.isArray(valor))
    valor = {};
  return StoreSettingsSchema.parse(valor);
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = parseStoreSettings({});

// ---------------------------------------------------------------------------
// Escritura: estricta, con mensajes para el dueño
// ---------------------------------------------------------------------------

/** `""` y espacios → `null` ("el de siempre"); el resto, recortado. */
const limpio = (valor: unknown): unknown => {
  if (typeof valor !== "string") return valor;
  const recortado = valor.trim();
  return recortado === "" ? null : recortado;
};

function textoHasta(maximo: number, campo: string) {
  return z.preprocess(
    limpio,
    z
      .string()
      .max(maximo, t("adminError.ajustes.largo", { campo, maximo }))
      .nullable()
      .default(null)
  );
}

/** Un link de la tienda (`/categoria/ofertas`) o uno `https://` de afuera. */
function linkHasta(maximo: number, campo: string) {
  return z.preprocess(
    limpio,
    z
      .string()
      .max(maximo, t("adminError.ajustes.largo", { campo, maximo }))
      .refine(
        (valor) =>
          (valor.startsWith("/") && !valor.startsWith("//")) || esHttps(valor),
        t("adminError.ajustes.link", { campo })
      )
      .nullable()
      .default(null)
  );
}

function httpsHasta(maximo: number, campo: string) {
  return z.preprocess(
    limpio,
    z
      .string()
      .max(maximo, t("adminError.ajustes.largo", { campo, maximo }))
      .refine(esHttps, t("adminError.ajustes.https", { campo }))
      .nullable()
      .default(null)
  );
}

function esHttps(valor: string): boolean {
  try {
    const url = new URL(valor);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** `"12"` del formulario → `12`; `""` → `null`. */
function enteroEntre(minimo: number, maximo: number, campo: string) {
  return z.preprocess(
    (valor) => {
      const valorLimpio = limpio(valor);
      if (typeof valorLimpio === "string") {
        const sinPuntos = valorLimpio.replace(/[.\s]/g, "");
        return /^-?\d+$/.test(sinPuntos) ? Number(sinPuntos) : valorLimpio;
      }
      return valorLimpio;
    },
    z
      .number(t("adminError.ajustes.numero", { campo }))
      .int(t("adminError.ajustes.numero", { campo }))
      .min(minimo, t("adminError.ajustes.rango", { campo, minimo, maximo }))
      .max(maximo, t("adminError.ajustes.rango", { campo, minimo, maximo }))
      .nullable()
      .default(null)
  );
}

const booleano = (porDefecto: boolean) => z.boolean().default(porDefecto);

const PaginaInput = z
  .object({
    activo: booleano(false),
    titulo: textoHasta(80, t("panel.ajustes.paginas.titulo")),
    cuerpo: z.preprocess(
      limpio,
      z
        .string()
        .max(
          20_000,
          t("adminError.ajustes.largo", {
            campo: t("panel.ajustes.paginas.cuerpo"),
            maximo: 20_000,
          })
        )
        .nullable()
        .default(null)
    ),
  })
  .strict();

const DIAS = 90;

/** `#1a2b3c`. Sin `#abc` corto ni nombres: un solo formato para guardar. */
export const COLOR_HEX = /^#[0-9a-f]{6}$/;

export const SECTION_INPUT = {
  identidad: z
    .object({
      nombre: textoHasta(60, t("panel.ajustes.identidad.nombre")),
      logoId: textoHasta(255, t("panel.ajustes.identidad.logo")),
      faviconId: textoHasta(255, t("panel.ajustes.identidad.favicon")),
      colorPrimario: z.preprocess(
        (valor) => {
          const valorLimpio = limpio(valor);
          return typeof valorLimpio === "string"
            ? valorLimpio.toLowerCase()
            : valorLimpio;
        },
        z
          .string()
          .regex(COLOR_HEX, t("adminError.ajustes.color"))
          .nullable()
          .default(null)
      ),
    })
    .strict(),
  cuentas: z
    .object({
      activas: z.boolean().nullable().default(null),
    })
    .strict(),
  marca: z
    .object({
      tagline: textoHasta(200, t("panel.ajustes.marca.tagline")),
      seoTitulo: textoHasta(70, t("panel.ajustes.marca.seoTitulo")),
      seoDescripcion: textoHasta(170, t("panel.ajustes.marca.seoDescripcion")),
      heroActivo: booleano(true),
      heroTitulo: textoHasta(120, t("panel.ajustes.marca.heroTitulo")),
      heroTexto: textoHasta(300, t("panel.ajustes.marca.heroTexto")),
      heroCtaLabel: textoHasta(40, t("panel.ajustes.marca.heroCtaLabel")),
      heroCtaHref: linkHasta(300, t("panel.ajustes.marca.heroCtaHref")),
      heroImagenId: textoHasta(255, t("panel.ajustes.marca.heroImagen")),
      heroImagenAlt: textoHasta(160, t("panel.ajustes.marca.heroImagenAlt")),
    })
    .strict(),
  anuncio: z
    .object({
      activo: booleano(false),
      texto: textoHasta(140, t("panel.ajustes.anuncio.texto")),
      href: linkHasta(300, t("panel.ajustes.anuncio.href")),
    })
    .strict()
    .refine((valor) => !valor.activo || valor.texto !== null, {
      message: t("adminError.ajustes.anuncioSinTexto"),
    }),
  contacto: z
    .object({
      whatsapp: z.preprocess(
        limpio,
        z
          .string()
          .transform((valor, ctx) => {
            const normalizado = normalizePhonePY(valor);
            if (!normalizado) {
              ctx.addIssue({
                code: "custom",
                message: t("adminError.ajustes.whatsapp"),
              });
              return z.NEVER;
            }
            return normalizado;
          })
          .nullable()
          .default(null)
      ),
      email: z.preprocess(
        limpio,
        z.email(t("adminError.ajustes.email")).max(120).nullable().default(null)
      ),
      direccion: textoHasta(200, t("panel.ajustes.contacto.direccion")),
      horario: textoHasta(200, t("panel.ajustes.contacto.horario")),
      instagram: httpsHasta(300, "Instagram"),
      facebook: httpsHasta(300, "Facebook"),
      tiktok: httpsHasta(300, "TikTok"),
    })
    .strict(),
  envioDevolucion: z
    .object({
      handlingDaysMin: enteroEntre(
        0,
        DIAS,
        t("panel.ajustes.envio.preparacionMin")
      ),
      handlingDaysMax: enteroEntre(
        0,
        DIAS,
        t("panel.ajustes.envio.preparacionMax")
      ),
      transitDaysMin: enteroEntre(
        0,
        DIAS,
        t("panel.ajustes.envio.transitoMin")
      ),
      transitDaysMax: enteroEntre(
        0,
        DIAS,
        t("panel.ajustes.envio.transitoMax")
      ),
      shippingFromPyg: enteroEntre(
        0,
        100_000_000,
        t("panel.ajustes.envio.desde")
      ),
      acceptsReturns: z.boolean().nullable().default(null),
      returnDays: enteroEntre(1, 365, t("panel.ajustes.envio.diasDevolucion")),
      returnFees: z.preprocess(
        limpio,
        z.enum(RETURN_FEES).nullable().default(null)
      ),
      returnMethod: z.preprocess(
        limpio,
        z.enum(RETURN_METHODS).nullable().default(null)
      ),
    })
    .strict()
    .refine((v) => rangoValido(v.handlingDaysMin, v.handlingDaysMax), {
      message: t("adminError.ajustes.rangoDias", {
        campo: t("panel.ajustes.envio.preparacion"),
      }),
    })
    .refine((v) => rangoValido(v.transitDaysMin, v.transitDaysMax), {
      message: t("adminError.ajustes.rangoDias", {
        campo: t("panel.ajustes.envio.transito"),
      }),
    })
    .refine((v) => v.acceptsReturns !== true || v.returnDays !== null, {
      message: t("adminError.ajustes.diasDevolucion"),
    }),
  paginas: z
    .object({
      envios: PaginaInput.optional(),
      devoluciones: PaginaInput.optional(),
      "preguntas-frecuentes": PaginaInput.optional(),
      terminos: PaginaInput.optional(),
      privacidad: PaginaInput.optional(),
    })
    .strict(),
  vidriera: z
    .object({
      estrellasEnTarjetas: booleano(true),
      barraCompraMovil: booleano(true),
    })
    .strict(),
  checkout: z
    .object({
      confianzaActiva: booleano(true),
      confianzaTitulo: textoHasta(60, t("panel.ajustes.checkout.titulo")),
      confianzaLineas: z
        .array(textoHasta(120, t("panel.ajustes.checkout.linea")))
        .max(4, t("adminError.ajustes.lineas"))
        .default([])
        // Las líneas vacías se van; sin ninguna, vuelven las de siempre.
        .transform((lineas) => {
          const llenas = lineas.filter(
            (linea): linea is string => linea !== null
          );
          return llenas.length > 0 ? llenas : null;
        }),
    })
    .strict(),
  stock: z
    .object({
      umbralStockBajo: enteroEntre(0, 1000, t("panel.ajustes.stock.umbral")),
    })
    .strict(),
} as const satisfies Record<StoreSettingsSection, z.ZodType>;

/** Lo que el formulario de cada sección puede mandar (antes de validar). */
export type SectionInput<S extends StoreSettingsSection> = z.input<
  (typeof SECTION_INPUT)[S]
>;

function rangoValido(minimo: number | null, maximo: number | null): boolean {
  if (minimo === null || maximo === null)
    return minimo === null && maximo === null;
  return minimo <= maximo;
}

// ---------------------------------------------------------------------------
// Precedencia: ajuste → config → entorno
// ---------------------------------------------------------------------------

/**
 * La portada que se dibuja, o `null` si el dueño la apagó.
 *
 * `base` es la que la home dibujaría sin ajustes (`TIENDA.hero` o la del
 * template): cada campo cargado en el panel pisa **ese** campo y nada más, así
 * que cambiar sólo el título conserva la foto y el botón de `tienda.ts`.
 */
export function heroEfectivo(
  marca: StoreSettings["marca"],
  base: Hero
): Hero | null {
  if (!marca.heroActivo) return null;

  const titulo = marca.heroTitulo ?? base.titulo;
  const texto = marca.heroTexto ?? base.texto;

  const label = marca.heroCtaLabel ?? base.cta?.label ?? null;
  const href = linkSeguro(marca.heroCtaHref) ?? base.cta?.href ?? null;
  const cta = label && href ? { label, href } : undefined;

  const cloudinaryId = marca.heroImagenId ?? base.imagen?.cloudinaryId ?? null;
  const imagen = cloudinaryId
    ? { cloudinaryId, alt: marca.heroImagenAlt ?? base.imagen?.alt ?? titulo }
    : null;

  return { titulo, texto, cta, imagen };
}

/**
 * Un link guardado, sólo si es de la tienda (`/…`) o `https://`. Lo mismo que
 * exige la escritura, repetido al leer por si la fila se editó a mano.
 */
export function linkSeguro(valor: string | null): string | null {
  if (!valor) return null;
  return (valor.startsWith("/") && !valor.startsWith("//")) || esHttps(valor)
    ? valor
    : null;
}

export type ContactoEfectivo = {
  whatsapp: string | null;
  email: string | null;
  direccion: string | null;
  horario: string | null;
  redes: { red: "instagram" | "facebook" | "tiktok"; url: string }[];
};

/**
 * El contacto **público**. El WhatsApp del panel gana; sin él, el de
 * `WHATSAPP_NUMBER` (que sigue siendo, además, a donde le llegan los avisos
 * al dueño — ese no se toca desde acá).
 */
export function contactoEfectivo(
  contacto: StoreSettings["contacto"],
  whatsappDeEntorno: string | null
): ContactoEfectivo {
  const redes: ContactoEfectivo["redes"] = [];
  // `esHttps` otra vez al leer: una fila editada a mano no puede meter un
  // `javascript:` en un `href` del pie.
  if (contacto.instagram && esHttps(contacto.instagram))
    redes.push({ red: "instagram", url: contacto.instagram });
  if (contacto.facebook && esHttps(contacto.facebook))
    redes.push({ red: "facebook", url: contacto.facebook });
  if (contacto.tiktok && esHttps(contacto.tiktok))
    redes.push({ red: "tiktok", url: contacto.tiktok });

  return {
    whatsapp:
      (contacto.whatsapp && normalizePhonePY(contacto.whatsapp)) ||
      whatsappDeEntorno,
    email: contacto.email,
    direccion: contacto.direccion,
    horario: contacto.horario,
    redes,
  };
}

/** El umbral global de stock bajo: el del panel o el de siempre. */
export function umbralStockBajo(
  stock: StoreSettings["stock"],
  porDefecto: number
): number {
  const valor = stock.umbralStockBajo;
  return valor !== null && Number.isInteger(valor) && valor >= 0
    ? valor
    : porDefecto;
}

/** Las líneas de confianza del checkout: las del panel o las de siempre. */
export function lineasDeConfianza(
  checkout: StoreSettings["checkout"]
): string[] {
  const propias = (checkout.confianzaLineas ?? [])
    .map((linea) => linea.trim())
    .filter((linea) => linea !== "")
    .slice(0, 4);
  if (propias.length > 0) return propias;
  return [
    t("checkout.confianza.linea1"),
    t("checkout.confianza.linea2"),
    t("checkout.confianza.linea3"),
  ];
}

/** El nombre que se ve: el del panel o, si no hay, el de `tienda.ts`. */
export function nombreEfectivo(
  identidad: StoreSettings["identidad"],
  porDefecto: string
): string {
  return identidad.nombre?.trim() || porDefecto;
}

/** ¿Hay cuentas de cliente? El panel decide; sin decisión, `tienda.ts`. */
export function cuentasEfectivas(
  cuentas: StoreSettings["cuentas"],
  porDefecto: boolean
): boolean {
  return cuentas.activas ?? porDefecto;
}

/**
 * El color de marca como variables CSS, o `null` si no hay (o si lo guardado
 * no tiene la forma esperada: el valor termina en un atributo `style`, así que
 * se revalida al leer). El texto encima del color se elige por contraste
 * (luminancia relativa de WCAG): blanco sobre colores oscuros, casi negro
 * sobre claros — el dueño elige un color, no un par.
 */
export function variablesDeColor(
  identidad: StoreSettings["identidad"]
): Record<"--primary" | "--primary-foreground" | "--ring", string> | null {
  const color = identidad.colorPrimario?.toLowerCase() ?? "";
  if (!COLOR_HEX.test(color)) return null;
  return {
    "--primary": color,
    "--primary-foreground": textoSobre(color),
    "--ring": color,
  };
}

function textoSobre(hex: string): string {
  const canal = (inicio: number): number => {
    const valor = parseInt(hex.slice(inicio, inicio + 2), 16) / 255;
    return valor <= 0.03928 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4;
  };
  const luminancia = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  // Contraste contra blanco vs. contra casi negro (#171717): gana el mayor.
  const contraBlanco = 1.05 / (luminancia + 0.05);
  const contraNegro = (luminancia + 0.05) / (0.008 + 0.05);
  return contraBlanco >= contraNegro ? "#ffffff" : "#171717";
}
