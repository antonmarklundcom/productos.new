"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n/client";

/**
 * Campo de datos bancarios con botón de copiar.
 *
 * ARCH.md §5: tipear un número de cuenta en el celular es donde se caen los
 * pedidos — cada campo tiene su propio botón, y el botón usa `onClick` de
 * React (nunca `onclick=""` inline, el CSP con nonce no admite scripts
 * inline).
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t("copiar.ok", { campo: label }));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copiar.error"));
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <dt className="text-muted-foreground text-xs">{label}</dt>
        <dd className="truncate text-sm font-medium tabular-nums">{value}</dd>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={copy}
        className="shrink-0"
      >
        {copied ? t("copiar.listo") : t("copiar.boton")}
      </Button>
    </div>
  );
}
