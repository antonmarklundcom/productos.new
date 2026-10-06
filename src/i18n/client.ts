import { TIENDA } from "@/config/tienda";
import { publicCatalogs } from "./public-catalogs";
import type { MessageKey, Params, PluralKey } from "./index";
export type { MessageKey, Params, PluralKey } from "./index";

/** Storefront code imports the small surface; admin/setup keep the full catalog. */
export function t(key: MessageKey, params?: Params): string {
  const template =
    publicCatalogs[TIENDA.lang]?.[key] ?? publicCatalogs["es-PY"]![key];
  if (template === undefined)
    throw new Error(`Missing storefront message: ${key}`);
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (hole, name: string) =>
        params[name] === undefined ? hole : String(params[name])
      );
}
export function tPlural(key: PluralKey, n: number, params?: Params): string {
  return t(`${key}.${n === 1 ? "uno" : "varios"}` as MessageKey, {
    ...params,
    n,
  });
}
