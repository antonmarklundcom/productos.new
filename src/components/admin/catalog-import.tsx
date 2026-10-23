"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  applyCatalogImport,
  previewCatalogImport,
  type CatalogImportSummary,
} from "@/app/actions/admin-products";
import { t, tPlural } from "@/i18n";
import { catalogOnly } from "@/config/catalog-capabilities";

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
  const [source, setSource] = useState<"file" | "paste">("file");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pisarStock, setPisarStock] = useState(false);
  const [summary, setSummary] = useState<CatalogImportSummary | null>(null);
  const [duplicatesReviewed, setDuplicatesReviewed] = useState(false);
  const [errores, setErrores] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const buildFormData = (): FormData | null => {
    const file =
      source === "paste"
        ? csvText.trim()
          ? new File([csvText], "catalogo.csv", { type: "text/csv" })
          : undefined
        : inputRef.current?.files?.[0];
    if (!file) {
      toast.error(
        t(
          source === "paste"
            ? "panel.productos.importar.pegaCsvVacio"
            : "adminError.elegiArchivo"
        )
      );
      return null;
    }
    const formData = new FormData();
    formData.set("file", file);
    formData.set("pisarStock", pisarStock ? "true" : "false");
    if (duplicatesReviewed && summary?.advertencias?.length)
      formData.set("duplicateReview", JSON.stringify(summary.advertencias));
    return formData;
  };

  const revisar = (): void => {
    setDuplicatesReviewed(false);
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
      if (catalogOnly) {
      // Store only a digest and random identity; file bytes and supplier data stay out of browser storage.
      const selectedFile=formData.get("file") as File;
      const digest=await crypto.subtle.digest("SHA-256",await selectedFile.arrayBuffer());
      const fingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("")+":"+String(pisarStock);
      const storageKey="catalog-import-v1";
      let pending:{id:string;fingerprint:string}|null=null;
      try{const saved=sessionStorage.getItem(storageKey);if(saved)pending=JSON.parse(saved);}catch{setErrores(["No se pudo recuperar la identidad de importación. Usá Nueva importación para comenzar otra."]);return;}
      if(pending&&pending.fingerprint!==fingerprint){setErrores(["Hay otra importación pendiente con un archivo u opciones distintos. Volvé a elegir el original para continuar o usá Nueva importación."]);return;}
      if(!pending){pending={id:crypto.randomUUID(),fingerprint};try{sessionStorage.setItem(storageKey,JSON.stringify(pending));}catch{setErrores(["El navegador no permite guardar la identidad para reintentar de forma segura."]);return;}}
      formData.set("importId",pending.id);
      }
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
            })
      );
      if (result.fotosOmitidas > 0) {
        toast.warning(
          t("panel.productos.importar.fotosOmitidas", {
            n: result.fotosOmitidas,
          })
        );
      }
      if (result.fotosFallidas.length > 0) {
        toast.error(
          tPlural(
            "panel.productos.importar.fotosFallidas",
            result.fotosFallidas.length
          )
        );
      }
      if (catalogOnly) sessionStorage.removeItem("catalog-import-v1");
      setSummary(null);
      setErrores(null);
      setFileName(null);
      setCsvText("");
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  return (
    <div className="border-border rounded-xl border p-4">
      <h2 className="text-sm font-semibold">
        {t("panel.productos.importar.titulo")}
      </h2>
      <p className="text-muted-foreground mt-1 text-xs">
        {t("panel.productos.importar.ayuda")}
      </p>

      {catalogOnly ? (<>
      <button type="button" className="mt-2 text-xs underline" disabled={isPending} onClick={()=>{sessionStorage.removeItem("catalog-import-v1");setSummary(null);setErrores(null);}}>Nueva importación</button>
      <p className="text-muted-foreground mt-1 text-xs">Si se corta la conexión o recargás, elegí el mismo archivo y opciones para continuar desde los lotes confirmados. Los lotes ya guardados pueden estar publicados.</p>
      </>) : null}
      <fieldset
        className="mt-3 flex flex-wrap gap-4 text-sm"
        disabled={isPending}
      >
        <legend className="sr-only">
          {t("panel.productos.importar.origen")}
        </legend>
        {(["file", "paste"] as const).map((option) => (
          <label key={option} className="flex items-center gap-2">
            <input
              type="radio"
              name="catalog-import-source"
              value={option}
              checked={source === option}
              onChange={() => {
                setSource(option);
                setSummary(null);
                setErrores(null);
              }}
            />
            {t(
              option === "file"
                ? "panel.productos.importar.archivo"
                : "panel.productos.importar.pegaCsv"
            )}
          </label>
        ))}
      </fieldset>
      {source === "paste" ? (
        <div className="mt-3 grid gap-2">
          <label htmlFor="catalog-import-csv" className="text-sm">
            {t("panel.productos.importar.csvTexto")}
          </label>
          <textarea
            id="catalog-import-csv"
            rows={8}
            value={csvText}
            disabled={isPending}
            onChange={(event) => {
              setCsvText(event.target.value);
              setSummary(null);
              setErrores(null);
            }}
            className="border-border rounded-lg border p-2 font-mono text-xs"
          />
          <p className="text-muted-foreground text-xs">
            {t("panel.productos.importar.pegaCsvAyuda")}
          </p>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          hidden={source === "paste"}
          disabled={isPending}
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
          disabled={
            isPending || (source === "paste" ? !csvText.trim() : !fileName)
          }
          className="border-border hover:bg-muted rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
        >
          {t("panel.productos.importar.revisar")}
        </button>
      </div>

      <label className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          disabled={isPending}
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
          {summary.advertencias?.length ? (
            <div className="mb-3 rounded-lg border border-amber-400 p-3">
              <p className="font-medium">
                {t("panel.productos.importar.duplicados")}
              </p>
              <ul className="mt-2 list-disc pl-4">
                {summary.advertencias.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <label className="mt-3 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={duplicatesReviewed}
                  disabled={isPending}
                  onChange={(event) =>
                    setDuplicatesReviewed(event.target.checked)
                  }
                />
                {t("panel.productos.importar.revisados")}
              </label>
            </div>
          ) : null}
          <p>
            {tPlural(
              "panel.productos.importar.productosNuevos",
              summary.productosNuevos
            )}
            {" · "}
            {tPlural(
              "panel.productos.importar.productosActualizar",
              summary.productosActualizar
            )}
          </p>
          <p className="mt-1">
            {tPlural(
              "panel.productos.importar.variantesNuevas",
              summary.variantesNuevas
            )}
            {" · "}
            {tPlural(
              "panel.productos.importar.variantesActualizar",
              summary.variantesActualizar
            )}
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
              {tPlural(
                "panel.productos.importar.fotosNuevas",
                summary.fotosNuevas
              )}
            </p>
          ) : null}

          <button
            type="button"
            onClick={confirmar}
            disabled={
              isPending ||
              Boolean(summary.advertencias?.length && !duplicatesReviewed)
            }
            className="bg-primary text-primary-foreground mt-3 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {isPending
              ? t("panel.productos.importar.aplicando")
              : t("panel.productos.importar.confirmar")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
