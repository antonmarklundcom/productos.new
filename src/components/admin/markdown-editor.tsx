"use client";

import { useId, useState } from "react";

import { Label } from "@/components/ui/label";
import { renderMarkdown } from "@/lib/markdown";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

/**
 * Editor de descripción con markdown seguro (plan-operacion §6.2).
 *
 * Es un `<textarea>` de toda la vida que manda `name` en un form nativo —el
 * mismo contrato que tenía la descripción antes de este PR— más una pestaña
 * "Vista previa" que renderiza con `renderMarkdown` de `src/lib/markdown.ts`
 * **en el cliente**. No hay ninguna llamada al servidor acá: la función es
 * pura y ya vive en el bundle del navegador (límite §4.7 — nada de una server
 * action nueva sólo para previsualizar texto).
 */
export function MarkdownEditor({
  name,
  label,
  defaultValue,
  rows = 6,
}: {
  name: string;
  label: string;
  defaultValue: string;
  rows?: number;
}) {
  const id = useId();
  const [tab, setTab] = useState<"editar" | "previa">("editar");
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>

      <div className="flex gap-1 text-sm">
        <button
          type="button"
          data-testid={TESTIDS.adminMarkdownTabEdit}
          aria-pressed={tab === "editar"}
          onClick={() => setTab("editar")}
          className={
            tab === "editar"
              ? "border-border bg-muted rounded-t-md border border-b-0 px-3 py-1 font-medium"
              : "text-muted-foreground border-border/50 rounded-t-md border border-b-0 px-3 py-1"
          }
        >
          {t("panel.markdown.editar")}
        </button>
        <button
          type="button"
          data-testid={TESTIDS.adminMarkdownTabPreview}
          aria-pressed={tab === "previa"}
          onClick={() => setTab("previa")}
          className={
            tab === "previa"
              ? "border-border bg-muted rounded-t-md border border-b-0 px-3 py-1 font-medium"
              : "text-muted-foreground border-border/50 rounded-t-md border border-b-0 px-3 py-1"
          }
        >
          {t("panel.markdown.vistaPrevia")}
        </button>
      </div>

      {tab === "editar" ? (
        <textarea
          id={id}
          name={name}
          rows={rows}
          data-testid={TESTIDS.adminMarkdownTextarea}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
        />
      ) : (
        <div
          data-testid={TESTIDS.adminMarkdownPreview}
          className="prose prose-sm border-input bg-muted/30 min-h-24 max-w-none rounded-md border px-3 py-2 text-sm"
          // El HTML lo produce `renderMarkdown`, que escapa TODO el texto de
          // entrada antes de agregar sus propias marcas (ver el comentario de
          // ese archivo) — no hay dato de usuario que llegue sin pasar por
          // `escapar()`.
          dangerouslySetInnerHTML={{
            __html: value.trim() === "" ? "" : renderMarkdown(value),
          }}
        />
      )}
      {tab === "previa" && value.trim() === "" ? (
        <p className="text-muted-foreground text-xs">{t("panel.markdown.vacio")}</p>
      ) : null}

      <p className="text-muted-foreground text-xs">{t("panel.markdown.ayuda")}</p>
    </div>
  );
}
