"use client";

import { useRouter } from "next/navigation";
import {
  ADMIN_PRODUCT_SORTS,
  ADMIN_PRODUCT_SORT_LABEL,
  ADMIN_PRODUCT_MODE_LABEL,
  type AdminProductSort,
  type AdminProductMode,
  type AdminProductStatus,
} from "@/lib/admin-product-sort";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

export function ProductFilters({
  categories,
  categoryId,
  sort,
  search,
  featured = false,
  status,
  saleMode,
  minPricePyg,
  maxPricePyg,
  minMarginPercent,
  costState,
}: {
  categories: Array<{ id: number; name: string }>;
  categoryId: number | undefined;
  sort: AdminProductSort;
  search: string | undefined;
  featured?: boolean;
  status?: AdminProductStatus;
  saleMode?: AdminProductMode;
  minPricePyg?: number;
  maxPricePyg?: number;
  minMarginPercent?: number;
  costState?: "completos" | "faltantes";
}) {
  const router = useRouter();
  const selectClass =
    "border-input bg-background h-9 min-w-0 max-w-full rounded-md border px-3 text-sm";
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const params = new URLSearchParams();
        for (const [key, value] of new FormData(event.currentTarget)) {
          if (
            typeof value === "string" &&
            value !== "" &&
            !(key === "orden" && value === "recientes")
          )
            params.set(key, value);
        }
        const qs = params.toString();
        router.push(qs ? `/admin/productos?${qs}` : "/admin/productos");
      }}
    >
      {search ? <input type="hidden" name="q" value={search} /> : null}
      <label className="grid gap-1 text-xs">
        {t("panel.filtros.categoria")}
        <select
          id="categoria"
          name="categoria"
          defaultValue={categoryId ?? ""}
          className={selectClass}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          <option value="">{t("panel.filtros.todasCategorias")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        {t("panel.filtros.ordenar")}
        <select
          id="orden"
          name="orden"
          defaultValue={sort}
          className={selectClass}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {ADMIN_PRODUCT_SORTS.map((value) => (
            <option key={value} value={value}>
              {ADMIN_PRODUCT_SORT_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        {t("panel.productos.estado")}
        <select
          name="estado"
          defaultValue={status ?? ""}
          className={selectClass}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          <option value="">{t("panel.filtros.todos")}</option>
          <option value="publicados">{t("panel.productos.publicados")}</option>
          <option value="sin-publicar">
            {t("panel.productos.noPublicados")}
          </option>
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        {t("panel.productos.modo")}
        <select
          name="modo"
          defaultValue={saleMode ?? ""}
          className={selectClass}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          <option value="">{t("panel.filtros.todos")}</option>
          {(["stock", "enquiry", "showcase"] as const).map((mode) => (
            <option key={mode} value={mode}>
              {ADMIN_PRODUCT_MODE_LABEL[mode]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        {t("panel.costos.filtro")}
        <select
          name="costos"
          defaultValue={costState ?? ""}
          className={selectClass}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          <option value="">{t("panel.filtros.todos")}</option>
          <option value="completos">{t("panel.costos.completos")}</option>
          <option value="faltantes">{t("panel.costos.faltantes")}</option>
        </select>
      </label>
      {(["desde", "hasta"] as const).map((key, index) => (
        <label key={key} className="grid gap-1 text-xs">
          {t(
            index === 0
              ? "panel.productos.precioMin"
              : "panel.productos.precioMax"
          )}
          <input
            type="number"
            name={key}
            min={0}
            step={1}
            defaultValue={
              index === 0 ? (minPricePyg ?? "") : (maxPricePyg ?? "")
            }
            className={`${selectClass} w-36`}
          />
        </label>
      ))}
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="destacados"
          value="1"
          data-testid={TESTIDS.adminProductFeaturedFilter}
          defaultChecked={featured}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        />
        {t("panel.filtros.destacados")}
      </label>
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="margen"
          value="50"
          defaultChecked={minMarginPercent === 50}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        />
        {t("panel.costos.margen50")}
      </label>
      <button
        type="submit"
        className="border-border h-9 rounded-md border px-3 text-sm"
      >
        {t("panel.filtros.aplicar")}
      </button>
      <button
        type="button"
        onClick={() => router.push("/admin/productos")}
        className="h-9 px-2 text-sm underline"
      >
        {t("panel.filtros.limpiar")}
      </button>
      <p className="text-muted-foreground w-full text-xs">
        {t("panel.productos.precioRangoAyuda")}
      </p>
    </form>
  );
}
