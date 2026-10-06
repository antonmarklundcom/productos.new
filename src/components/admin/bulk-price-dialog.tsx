"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  bulkAdjustProductPrices,
  previewBulkPriceAdjustment,
} from "@/app/actions/admin-products";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatGs } from "@/lib/money";
import { TESTIDS } from "@/lib/testids";
import { t, tPlural } from "@/i18n";

type Preview = {
  cambiadas: number;
  miradas: number;
  diferenciaPyg: number;
  ejemplos: Array<{ variantId: number; from: number; to: number }>;
};

/**
 * Ajuste masivo de precios por porcentaje (O7 §5.3 B). **Owner-only**: el
 * botón que lo abre sólo se dibuja cuando `can(role, 'precios.masivo')` —
 * ver `BulkActionsBar` — pero el guard real es `bulkAdjustProductPrices`, que
 * vuelve a chequear el rol del lado del servidor.
 *
 * Dos pasos, no uno: primero la vista previa (`previewBulkPriceAdjustment`,
 * misma fórmula que la escritura — `src/domain/admin-bulk.ts`), después una
 * confirmación explícita que repite la cantidad de variantes, el porcentaje y
 * el motivo. Un +10 % de más no se ve hasta que ya se vendió a ese precio.
 */
export function BulkPriceDialog({
  productIds,
  onApplied,
}: {
  productIds: number[];
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"form" | "confirmar">("form");
  const [percent, setPercent] = useState("10");
  const [roundTo, setRoundTo] = useState<"100" | "1000">("100");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reset = (): void => {
    setStep("form");
    setPreview(null);
    setError(null);
    setReason("");
  };

  const runPreview = (): void => {
    setError(null);
    const percentNum = Number(percent);
    if (!Number.isInteger(percentNum)) {
      setError(t("adminForm.precioEntero"));
      return;
    }
    startTransition(async () => {
      const result = await previewBulkPriceAdjustment({
        productIds,
        percent: percentNum,
        roundTo: Number(roundTo),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result);
      setStep("confirmar");
    });
  };

  const confirmar = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await bulkAdjustProductPrices({
        productIds,
        percent: Number(percent),
        roundTo: Number(roundTo),
        reason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        `${tPlural("panel.masivo.precios.aplicado", result.cambiadas)} ${t("panel.masivo.precios.diferencia", {
          monto: formatGs(result.diferenciaPyg),
        })}`,
      );
      setOpen(false);
      reset();
      onApplied();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" data-testid={TESTIDS.adminBulkPriceOpen}>
          {t("panel.masivo.ajustarPrecios")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("panel.masivo.precios.titulo")}</DialogTitle>
          <DialogDescription>{t("panel.masivo.precios.bajada")}</DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="border-destructive/40 text-destructive rounded-lg border p-2 text-sm">
            {error}
          </p>
        ) : null}

        {step === "form" ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-percent">{t("panel.masivo.precios.porcentaje")}</Label>
              <Input
                id="bulk-percent"
                type="number"
                step={1}
                data-testid={TESTIDS.adminBulkPricePercent}
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-round">{t("panel.masivo.precios.redondeo")}</Label>
              <select
                id="bulk-round"
                data-testid={TESTIDS.adminBulkPriceRound}
                value={roundTo}
                onChange={(event) => setRoundTo(event.target.value as "100" | "1000")}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                <option value="100">{t("panel.masivo.precios.redondeo100")}</option>
                <option value="1000">{t("panel.masivo.precios.redondeo1000")}</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-reason">{t("panel.masivo.precios.motivo")}</Label>
              <Input
                id="bulk-reason"
                data-testid={TESTIDS.adminBulkPriceReason}
                value={reason}
                minLength={5}
                maxLength={500}
                placeholder={t("panel.masivo.precios.motivo.placeholder")}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                data-testid={TESTIDS.adminBulkPricePreview}
                disabled={isPending || reason.trim().length < 5}
                onClick={runPreview}
              >
                {isPending ? t("panel.masivo.precios.calculando") : t("panel.masivo.precios.verVistaPrevia")}
              </Button>
            </DialogFooter>
          </div>
        ) : preview ? (
          <div className="grid gap-3">
            <p className="text-sm font-medium">
              {t("panel.masivo.precios.vistaPrevia", {
                miradas: preview.miradas,
                cambiadas: preview.cambiadas,
              })}
            </p>
            {preview.ejemplos.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("panel.masivo.precios.sinCambios")}</p>
            ) : (
              <ul className="text-muted-foreground grid gap-1 text-xs tabular-nums">
                {preview.ejemplos.map((ejemplo) => (
                  <li key={ejemplo.variantId}>
                    {t("panel.masivo.precios.ejemploLinea", {
                      variantId: ejemplo.variantId,
                      desde: formatGs(ejemplo.from),
                      hasta: formatGs(ejemplo.to),
                    })}
                  </li>
                ))}
              </ul>
            )}

            {preview.cambiadas > 0 ? (
              <div className="border-border bg-muted/40 grid gap-2 rounded-lg border p-3 text-sm">
                <p className="font-medium">{t("panel.masivo.precios.confirmarTitulo")}</p>
                <p className="text-muted-foreground text-xs">
                  {t("panel.masivo.precios.confirmarBajada", {
                    cambiadas: preview.cambiadas,
                    porcentaje: percent,
                    redondeo: roundTo === "100" ? t("panel.masivo.precios.redondeo100") : t("panel.masivo.precios.redondeo1000"),
                    motivo: reason,
                  })}
                </p>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" disabled={isPending} onClick={() => setStep("form")}>
                {t("panel.acciones.volver")}
              </Button>
              {preview.cambiadas > 0 ? (
                <Button
                  type="button"
                  variant="destructive"
                  data-testid={TESTIDS.adminBulkPriceConfirm}
                  disabled={isPending}
                  onClick={confirmar}
                >
                  {isPending ? t("panel.acciones.guardando") : t("panel.masivo.precios.confirmarBoton")}
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
