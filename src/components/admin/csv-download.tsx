"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  exportMarketingOptInsCsv,
  exportOrdersCsv,
  exportProductsCsv,
} from "@/app/actions/admin-export";
import { t, tPlural } from "@/i18n";

/**
 * Botón de "Descargar CSV".
 *
 * El archivo lo arma el servidor con los filtros vigentes (ver
 * `actions/admin-export.ts`); acá sólo se recibe el texto y se lo entrega al
 * navegador como descarga. Un `<a href>` a una ruta no serviría igual: el
 * export es data del comercio y tiene que pasar por el guard de sesión de una
 * server action, no por una URL que se pueda pegar en un chat.
 */
export function CsvDownloadButton({
  kind,
  params,
  label,
}: {
  kind: "pedidos" | "productos" | "clientes-opt-in";
  /** Los filtros de la URL, tal cual están en pantalla. */
  params: Record<string, string | undefined>;
  label?: string;
}) {
  const texto = label ?? t("panel.csv.descargar");
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const download = (): void => {
    startTransition(async () => {
      const clean = Object.fromEntries(
        Object.entries(params).filter(([, value]) => value !== undefined && value !== ""),
      );
      const result =
        kind === "pedidos"
          ? await exportOrdersCsv(clean)
          : kind === "productos"
            ? await exportProductsCsv(clean)
            : await exportMarketingOptInsCsv();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      // Sin esto el blob queda vivo hasta que se recargue la página, y bajar
      // el listado diez veces deja diez copias en memoria del navegador.
      URL.revokeObjectURL(url);

      setNote(
        result.truncated
          ? t("panel.csv.truncado", { n: result.rows })
          : tPlural("panel.csv.filas", result.rows),
      );
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={download}
        disabled={isPending}
        className="border-border hover:bg-muted rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {isPending ? t("panel.csv.preparando") : texto}
      </button>
      {note ? (
        <span className="text-muted-foreground text-xs" role="status">
          {note}
        </span>
      ) : null}
    </div>
  );
}
