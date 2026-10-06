import { t } from "@/i18n/client";
import { formatGs } from "@/lib/money";

/**
 * Rangos de precio del filtro. Pensados para la góndola paraguaya, no
 * cuartiles calculados.
 *
 * Vive fuera del componente `"use client"` porque el listado de categoría es
 * un Server Component y necesita `parsePriceRange` para armar la query: un
 * módulo cliente no se puede llamar desde el servidor.
 */
export const PRICE_RANGES = [
  {
    id: "0-100000",
    label: t("precio.rango.hasta", { monto: formatGs(100000) }),
    min: 0,
    max: 100000 as number | undefined,
  },
  {
    id: "100000-300000",
    label: t("precio.rango.entre", {
      desde: formatGs(100000),
      hasta: formatGs(300000),
    }),
    min: 100000,
    max: 300000,
  },
  {
    id: "300000-1000000",
    label: t("precio.rango.entre", {
      desde: formatGs(300000),
      hasta: formatGs(1000000),
    }),
    min: 300000,
    max: 1000000,
  },
  {
    id: "1000000-",
    label: t("precio.rango.masDe", { monto: formatGs(1000000) }),
    min: 1000000,
    max: undefined,
  },
] as const;

/** `"100000-300000"` → `{ min, max }`. Devuelve `{}` si no matchea. */
export function parsePriceRange(value: string | undefined): {
  min?: number;
  max?: number;
} {
  const range = PRICE_RANGES.find((item) => item.id === value);
  if (!range) return {};
  return { min: range.min, max: range.max };
}
