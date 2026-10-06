"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  applyCatalogImport,
  previewCatalogImport,
  type CatalogImportSummary,
} from "@/app/actions/admin-products";
import { t, tPlural } from "@/i18n";

/**
 * Carga masiva de productos por planilla, desde `/admin/productos`.
 *
 * Dos pasos, no uno: "Revisar" corre el ensayo (`previewCatalogImport`, no
 * escribe nada) y sólo si no hay errores aparece "Confirmar e importar"
 * (`applyCatalogImport`). Es el mismo comportamiento de
 * `pnpm importar:productos` — ensayo por defecto, `--aplicar` para escribir —
 * pero con un botón en vez de un flag de consola.
 *
 * El archivo elegido se guarda en `inputRef` y se manda de nuevo (sin volver
 * a pedirlo) cuando se confirma: el `<input type="file">` del navegador no
 * pierde el `File` entre el ensayo y la confirmación.
 */
export function CatalogImportForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pisarStock, setPisarStock] = useState(false);
  const [summary, setSummary] = useState<CatalogImportSummary | null>(null);
  const [errores, setErrores] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const buildFormData = (): FormData | null => {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      toast.error(t("adminError.elegiArchivo"));
      return null;
    }
    const formData = new FormData();
    formData.set("file", file);
    formData.set("pisarStock", pisarStock ? "true" : "false");
    return formData;
  };

  const revisar = (): void => {
    const formData = buildFormData();
    if (!formData) return;

    setSummary(null);
    setErrores(null);
    startTransition(async () => {
      const result = await previewCatalogImport(formData);
      if (!result.ok) {
        setErrores(result.errores);
        return;
      }
      setSummary(result);
    });
  };

  const confirmar = (): void => {
    const formData = buildFormData();
    if (!formData) return;

    startTransition(async () => {
      const result = await applyCatalogImport(formData);
      if (!result.ok) {
        setErrores(result.errores);
        setSummary(null);
        return;
      }
      toast.success(
        result.fotosSubidas > 0
          ? t("panel.productos.importar.listoConFotos", {
              productos: result.productosNuevos + result.productosActualizar,
              variantes: result.variantesEscritas,
              fotos: result.fotosSubidas,
            })
          : t("panel.productos.importar.listo", {
              productos: result.productosNuevos + result.productosActualizar,
              variantes: result.variantesEscritas,
            }),
      );
      if (result.fotosOmitidas > 0) {
        toast.warning(t("panel.productos.importar.fotosOmitidas", { n: result.fotosOmitidas }));
      }
      if (result.fotosFallidas.length > 0) {
        toast.error(tPlural("panel.productos.importar.fotosFallidas", result.fotosFallidas.length));
      }
      setSummary(null);
      setErrores(null);
      setFileName(null);
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  return (
    <div className="border-border rounded-xl border p-4">
      <h2 className="text-sm font-semibold">{t("panel.productos.importar.titulo")}</h2>
      <p className="text-muted-foreground mt-1 text-xs">{t("panel.productos.importar.ayuda")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,text/csv"
          aria-label={t("panel.productos.importar.titulo")}
          onChange={(event) => {
            setFileName(event.target.files?.[0]?.name ?? null);
            setSummary(null);
            setErrores(null);
          }}
          className="text-sm"
        />
        <button
          type="button"
          onClick={revisar}
          disabled={isPending || !fileName}
          className="border-border hover:bg-muted rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
        >
          {t("panel.productos.importar.revisar")}
        </button>
      </div>

      <label className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={pisarStock}
          onChange={(event) => {
            setPisarStock(event.target.checked);
            setSummary(null);
          }}
        />
        {t("panel.productos.importar.pisarStock")}
      </label>

      {errores && errores.length > 0 ? (
        <ul className="border-destructive/40 bg-destructive/5 text-destructive mt-3 max-h-48 list-disc space-y-1 overflow-y-auto rounded-lg border p-3 pl-6 text-xs">
          {errores.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      ) : null}

      {summary ? (
        <div className="bg-muted/50 mt-3 rounded-lg p-3 text-xs">
          <p>
            {tPlural("panel.productos.importar.productosNuevos", summary.productosNuevos)}
            {" · "}
            {tPlural("panel.productos.importar.productosActualizar", summary.productosActualizar)}
          </p>
          <p className="mt-1">
            {tPlural("panel.productos.importar.variantesNuevas", summary.variantesNuevas)}
            {" · "}
            {tPlural("panel.productos.importar.variantesActualizar", summary.variantesActualizar)}
            {summary.variantesActualizar > 0
              ? summary.pisaStock
                ? ` — ${t("panel.productos.importar.pisandoStock")}`
                : ` — ${t("panel.productos.importar.stockIntacto")}`
              : ""}
          </p>
          {summary.categoriasNuevas.length > 0 ? (
            <p className="mt-1">
              {t("panel.productos.importar.categoriasNuevas", {
                categorias: summary.categoriasNuevas.join(", "),
              })}
            </p>
          ) : null}
          {summary.fotosNuevas > 0 ? (
            <p className="mt-1">
              {tPlural("panel.productos.importar.fotosNuevas", summary.fotosNuevas)}
            </p>
          ) : null}

          <button
            type="button"
            onClick={confirmar}
            disabled={isPending}
            className="bg-primary text-primary-foreground mt-3 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {isPending ? t("panel.productos.importar.aplicando") : t("panel.productos.importar.confirmar")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
