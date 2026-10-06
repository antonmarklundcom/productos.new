import { t } from "@/i18n/client";

/**
 * Los `{{…}}` de los textos de las páginas de políticas
 * (`src/config/paginas-default.ts`, o el texto que el dueño guardó).
 *
 * Regla única: **nunca sale un `{{` crudo ni un hueco.** Un dato que la
 * tienda no cargó se reemplaza por una frase que se lee bien en el lugar
 * donde está escrito el placeholder ("Email: por ahora, sólo por WhatsApp"),
 * y un placeholder que no existe —un typo del dueño, `{{whatsap}}`— se borra
 * junto con las llaves en vez de mostrarse.
 *
 * Pura y sin Node: la usa la página pública y también la vista previa del
 * panel.
 */

export const PLACEHOLDERS = [
  "tienda",
  "url",
  "whatsapp",
  "email",
  "direccion",
  "horario",
  "diasDevolucion",
  "mediosDePago",
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export type ValoresPlaceholder = Partial<
  Record<Placeholder, string | null | undefined>
>;

/** La frase de cada uno cuando no hay dato. */
function frasePorDefecto(nombre: Placeholder): string {
  switch (nombre) {
    case "tienda":
      return t("paginas.placeholder.tienda");
    case "url":
      return t("paginas.placeholder.url");
    case "whatsapp":
      return t("paginas.placeholder.whatsapp");
    case "email":
      return t("paginas.placeholder.email");
    case "direccion":
      return t("paginas.placeholder.direccion");
    case "horario":
      return t("paginas.placeholder.horario");
    case "diasDevolucion":
      return t("paginas.placeholder.diasDevolucion");
    case "mediosDePago":
      return t("paginas.placeholder.mediosDePago");
  }
}

function esPlaceholder(nombre: string): nombre is Placeholder {
  return (PLACEHOLDERS as readonly string[]).includes(nombre);
}

export function reemplazarPlaceholders(
  texto: string,
  valores: ValoresPlaceholder
): string {
  return texto.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_todo, nombre: string) => {
    if (!esPlaceholder(nombre)) return "";
    const valor = valores[nombre]?.trim();
    return valor ? valor : frasePorDefecto(nombre);
  });
}

/** "a, b y c" — la lista como se dice en castellano. */
export function listaConY(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${t("paginas.y")} ${items[items.length - 1]}`;
}
