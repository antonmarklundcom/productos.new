"use client";

import Link from "next/link";
import { useState } from "react";

import { BulkActionsBar } from "@/components/admin/bulk-actions";
import { ProductImage } from "@/components/product-image";
import { formatGs } from "@/lib/money";
import { ADMIN_PRODUCT_MODE_LABEL } from "@/lib/admin-product-sort";
import { TESTIDS } from "@/lib/testids";
import { t, tPlural } from "@/i18n";

export type ProductListRow = {
  id: number;
  slug: string;
  name: string;
  categoryName: string;
  categorySlug: string;
  variantCount: number;
  minPricePyg: number | null;
  maxPricePyg: number | null;
  minCostPyg: number | null;
  maxCostPyg: number | null;
  costCount: number;
  minMarginPercent: number | null;
  saleMode: "stock" | "enquiry" | "showcase";
  showPrice: boolean;
  dropiUrl: string | null;
  imageCount: number;
  onHand: number;
  isActive: boolean;
  publishedAt: string | null;
  imageCloudinaryId: string | null;
  imageAlt: string | null;
  // == S17 == Chip de destacado en el listado.
  isFeatured: boolean;
};

/**
 * El listado de `/admin/productos` con selección y acciones masivas
 * (O7, plan-operacion §6.2).
 *
 * Es un componente cliente y no una isla de checkboxes sueltos porque la
 * barra de acciones masivas necesita saber qué filas están tildadas en **esta**
 * pantalla — server-render por fila no tiene dónde guardar ese estado. El
 * resto del markup (miniatura, precio, stock) es el mismo que tenía la página
 * antes de este PR, sólo movido acá adentro.
 */
export function ProductList({
  rows,
  categories,
  canBulkPrice,
}: {
  rows: ProductListRow[];
  categories: Array<{ id: number; name: string }>;
  canBulkPrice: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected =
    rows.length > 0 && rows.every((row) => selected.has(row.id));

  return (
    <div>
      {rows.length > 0 ? (
        <label className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid={TESTIDS.adminProductSelectAll}
            checked={allSelected}
            onChange={(event) => {
              setSelected(
                event.target.checked
                  ? new Set(rows.map((row) => row.id))
                  : new Set()
              );
            }}
          />
          {t("panel.productos.seleccionarPagina")}
        </label>
      ) : null}

      {selected.size > 0 ? (
        <BulkActionsBar
          productIds={[...selected]}
          categories={categories}
          canBulkPrice={canBulkPrice}
          onDone={() => setSelected(new Set())}
        />
      ) : null}

      <ul className="mt-4 grid gap-3">
        {rows.map((product) => (
          <li
            key={product.id}
            className="border-border hover:bg-muted/50 flex flex-wrap items-center gap-3 rounded-xl border p-3"
          >
            <input
              type="checkbox"
              data-testid={TESTIDS.adminProductRowSelect}
              data-id={product.id}
              aria-label={t("panel.productos.seleccionar", {
                nombre: product.name,
              })}
              checked={selected.has(product.id)}
              onChange={() => toggle(product.id)}
            />

            <Link
              href={`/admin/productos/${product.id}`}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              {/* Miniatura chica: el dueño reconoce el producto por la foto
                  mucho antes que por el nombre, y son 24 filas en un
                  celular. */}
              <ProductImage
                image={
                  product.imageCloudinaryId
                    ? {
                        cloudinaryId: product.imageCloudinaryId,
                        alt: product.imageAlt,
                        blurDataUrl: null,
                      }
                    : null
                }
                alt={product.name}
                categorySlug={product.categorySlug}
                size="thumb"
                className="w-14 shrink-0"
                sizes="56px"
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="font-medium">
                    {product.name}
                    {/* == S17 == */}
                    {product.isFeatured ? (
                      <span
                        data-testid={TESTIDS.adminProductFeaturedChip}
                        className="bg-primary/10 text-primary ml-2 rounded-full px-2 py-0.5 text-xs font-medium"
                      >
                        {t("panel.productos.destacadoChip")}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm tabular-nums">
                    {product.minPricePyg === null
                      ? t("panel.productos.sinPrecio")
                      : formatGs(product.minPricePyg)}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {product.categoryName} ·{" "}
                  {tPlural("panel.productos.variantes", product.variantCount)} ·{" "}
                  <span
                    className={
                      product.onHand === 0 ? "text-destructive font-medium" : ""
                    }
                  >
                    {t("panel.productos.enStock", { n: product.onHand })}
                  </span>
                  {!product.isActive || product.publishedAt === null ? (
                    <span className="text-foreground font-medium">
                      {t("panel.productos.sinPublicar")}
                    </span>
                  ) : null}
                </p>
              </div>
            </Link>
            <div className="w-full border-t pt-2 text-xs sm:pl-7">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <p>
                  #{product.id} ·{" "}
                  {t("panel.productos.fotos", { n: product.imageCount })} ·{" "}
                  {ADMIN_PRODUCT_MODE_LABEL[product.saleMode]}
                </p>
                <p>
                  {t(
                    product.showPrice
                      ? "panel.productos.precioVisible"
                      : "panel.productos.precioOculto"
                  )}
                  {product.maxPricePyg !== null &&
                  product.maxPricePyg !== product.minPricePyg
                    ? ` · ${formatGs(product.minPricePyg ?? 0)}–${formatGs(product.maxPricePyg)}`
                    : ""}
                </p>
                <p>
                  {product.minCostPyg === null
                    ? t("panel.costos.sinDatos")
                    : t("panel.costos.rango", {
                        costo:
                          product.minCostPyg === product.maxCostPyg
                            ? formatGs(product.minCostPyg)
                            : `${formatGs(product.minCostPyg)}–${formatGs(product.maxCostPyg ?? product.minCostPyg)}`,
                      })}
                </p>
                <p>
                  {t("panel.costos.margen", {
                    margen:
                      product.minMarginPercent === null
                        ? "—"
                        : `${product.minMarginPercent.toFixed(1)}%`,
                  })}
                  {product.costCount < product.variantCount
                    ? ` · ${t("panel.costos.parciales", { n: product.costCount, total: product.variantCount })}`
                    : ""}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap gap-3">
                {product.isActive && product.publishedAt ? (
                  <Link
                    href={`/producto/${product.slug}`}
                    prefetch={false}
                    className="underline"
                  >
                    {t("panel.productos.verPublico")}
                  </Link>
                ) : null}
                {product.dropiUrl ? (
                  <a
                    href={product.dropiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {t("panel.productos.proveedor")}
                  </a>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
