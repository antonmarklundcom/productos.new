import { t } from "@/i18n";

/**
 * Órdenes del listado de productos del panel.
 *
 * Vive en `lib/` y no en `domain/admin-products.ts` a propósito: el selector
 * es un componente cliente, y cualquier `import` suyo al módulo de dominio se
 * lleva el pool de MySQL al bundle del navegador — el build de Next falla
 * pidiendo `tls`. Mismo motivo por el que `lib/price-ranges.ts` está separado
 * de las consultas del catálogo.
 *
 * `stock` es ascendente a propósito: nadie entra a productos a mirar lo que le
 * sobra, se entra a ver qué se está por acabar.
 */
export const ADMIN_PRODUCT_SORTS = [
  "recientes",
  "nombre-asc",
  "nombre-desc",
  "categoria-asc",
  "categoria-desc",
  "stock",
  "stock-desc",
  "precio-asc",
  "precio-desc",
  "costo-asc",
  "costo-desc",
  "margen-desc",
] as const;

export type AdminProductSort = (typeof ADMIN_PRODUCT_SORTS)[number];

export const ADMIN_PRODUCT_SORT_LABEL: Record<AdminProductSort, string> = {
  recientes: t("panel.orden.recientes"),
  stock: t("panel.orden.stock"),
  "nombre-asc": t("panel.orden.nombreAsc"),
  "nombre-desc": t("panel.orden.nombreDesc"),
  "categoria-asc": t("panel.orden.categoriaAsc"),
  "categoria-desc": t("panel.orden.categoriaDesc"),
  "stock-desc": t("panel.orden.stockDesc"),
  "costo-asc": t("panel.orden.costoAsc"),
  "costo-desc": t("panel.orden.costoDesc"),
  "margen-desc": t("panel.orden.margenDesc"),
  "precio-asc": t("panel.orden.precioAsc"),
  "precio-desc": t("panel.orden.precioDesc"),
};

export function isAdminProductSort(
  value: string | undefined
): value is AdminProductSort {
  return (
    value !== undefined &&
    (ADMIN_PRODUCT_SORTS as readonly string[]).includes(value)
  );
}

export const ADMIN_PRODUCT_STATUSES = ["publicados", "sin-publicar"] as const;
export type AdminProductStatus = (typeof ADMIN_PRODUCT_STATUSES)[number];
export const ADMIN_PRODUCT_MODES = ["stock", "enquiry", "showcase"] as const;
export type AdminProductMode = (typeof ADMIN_PRODUCT_MODES)[number];
export const ADMIN_PRODUCT_MODE_LABEL = {
  stock: t("panel.productos.modo.stock"),
  enquiry: t("panel.productos.modo.enquiry"),
  showcase: t("panel.productos.modo.showcase"),
};

export function parseAdminProductPrice(
  value: string | undefined
): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : undefined;
}
