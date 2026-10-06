"use client";

import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n/client";

/**
 * Selector de cantidad. Botones grandes a propósito: esto se usa con el
 * pulgar, en la calle, con una mano.
 */
export function QuantityStepper({
  value,
  onChange,
  max,
  min = 1,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  max: number;
  min?: number;
  label?: string;
}) {
  const groupLabel = label ?? t("cantidad.label");
  const canDecrease = value > min;
  const canIncrease = value < max;

  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label={groupLabel}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9"
        disabled={!canDecrease}
        onClick={() => onChange(value - 1)}
        aria-label={t("cantidad.quitarUno")}
      >
        <Minus className="size-4" />
      </Button>
      <span
        className="w-10 text-center text-sm font-medium tabular-nums"
        aria-live="polite"
      >
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9"
        disabled={!canIncrease}
        onClick={() => onChange(value + 1)}
        aria-label={t("cantidad.agregarUno")}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}
