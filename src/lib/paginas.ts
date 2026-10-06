import { PAGINAS_DEFAULT } from "@/config/paginas-default";
import type { PaymentMethod } from "@/db/schema";
import { isPagoparConfigured } from "@/domain/pagopar/config";
import { offeredPaymentMethods } from "@/domain/shipping";
import { getStoreSettings } from "@/domain/store-settings";
import { PAGINAS, type PaginaSlug, type StoreSettings } from "@/domain/store-settings-schema";
import { t, tPlural } from "@/i18n";
import { contactoPublico } from "@/lib/comercio";
import { listaConY, type ValoresPlaceholder } from "@/lib/placeholders";
import { formatPhonePY } from "@/lib/py";
import { siteOrigin } from "@/lib/site-url";
import { nombreTienda } from "@/lib/marca";

/**
 * Las páginas de políticas, ya resueltas: título y cuerpo efectivos
 * (el del panel o el de `src/config/paginas-default.ts`) y los valores de
 * sus `{{…}}`. Lo usan `src/components/policy-page.tsx`, el pie, el sitemap
 * y el editor del panel.
 */

export type PaginaEfectiva = {
  slug: PaginaSlug;
  activo: boolean;
  titulo: string;
  cuerpo: string;
  /** `true` mientras el dueño nunca guardó un texto propio. */
  cuerpoPorDefecto: boolean;
};

export function paginaEfectiva(ajustes: StoreSettings, slug: PaginaSlug): PaginaEfectiva {
  const guardada = ajustes.paginas[slug];
  const porDefecto = PAGINAS_DEFAULT[slug];
  return {
    slug,
    activo: guardada.activo,
    titulo: guardada.titulo ?? porDefecto.titulo,
    cuerpo: guardada.cuerpo ?? porDefecto.cuerpo,
    cuerpoPorDefecto: guardada.cuerpo === null,
  };
}

/** Las páginas prendidas, en el orden de siempre. Para el pie y el sitemap. */
export async function paginasActivas(): Promise<PaginaEfectiva[]> {
  const ajustes = await getStoreSettings();
  return PAGINAS.map((slug) => paginaEfectiva(ajustes, slug)).filter((pagina) => pagina.activo);
}

/** El nombre de cada medio de pago, como lo lee la compradora. */
export function nombreMedioDePago(method: PaymentMethod): string {
  switch (method) {
    case "transferencia":
      return t("checkout.pago.transferencia");
    case "contra_entrega":
      return t("checkout.pago.contraEntrega");
    case "tarjeta":
      return t("checkout.pago.tarjeta");
  }
}

/**
 * Los medios de pago que el checkout ofrece hoy. Si la base no contesta, la
 * lista vacía: mejor el texto genérico que prometer uno que no existe.
 */
export async function mediosDePagoOfrecidos(): Promise<PaymentMethod[]> {
  return offeredPaymentMethods({ cardEnabled: isPagoparConfigured() }).catch(() => []);
}

/** Los valores de los `{{…}}`: ajustes → entorno → `tienda.ts`. */
export async function valoresDePlaceholders(): Promise<ValoresPlaceholder> {
  const [ajustes, contacto, medios, nombre] = await Promise.all([
    getStoreSettings(),
    contactoPublico(),
    mediosDePagoOfrecidos(),
    nombreTienda(),
  ]);
  const origin = siteOrigin();
  const dias = ajustes.envioDevolucion.returnDays;

  return {
    tienda: nombre,
    url: origin ? origin.host : null,
    whatsapp: contacto.whatsapp ? formatPhonePY(contacto.whatsapp) : null,
    email: contacto.email,
    direccion: contacto.direccion,
    horario: contacto.horario,
    diasDevolucion: dias ? tPlural("paginas.dias", dias) : null,
    mediosDePago: medios.length > 0 ? listaConY(medios.map(nombreMedioDePago)) : null,
  };
}
