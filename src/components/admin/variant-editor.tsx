"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { adjustVariantStock, saveProductVariant } from "@/app/actions/admin-products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatGs } from "@/lib/money";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

export type VariantCard = {
  id: number;
  sku: string;
  label: string;
  pricePyg: number;
  compareAtPyg: number | null;
  isActive: boolean;
  onHand: number;
  heldQty: number;
  available: number;
  /** Umbral de "stock bajo" propio (O6). `null` = el umbral general de la tienda. */
  reorderPoint?: number | null;
};

export function VariantEditor({
  productId,
  variants,
}: {
  productId: number;
  variants: VariantCard[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="grid gap-3">
      {variants.map((variant) => (
        <VariantRow key={variant.id} productId={productId} variant={variant} />
      ))}

      {adding ? (
        <VariantFields productId={productId} onDone={() => setAdding(false)} />
      ) : (
        <Button type="button" variant="outline" onClick={() => setAdding(true)}>
          {t("panel.variante.agregar")}
        </Button>
      )}

      {variants.length === 0 && !adding ? (
        <p className="text-muted-foreground text-sm">{t("panel.variante.vacio")}</p>
      ) : null}
    </div>
  );
}

function VariantRow({ productId, variant }: { productId: number; variant: VariantCard }) {
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  return (
    <div className="border-border rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {variant.label}
          <span className="text-muted-foreground font-normal"> · {variant.sku}</span>
        </span>
        <span className="tabular-nums">{formatGs(variant.pricePyg)}</span>
      </div>

      <p className="text-muted-foreground mt-1 text-xs tabular-nums">
        {t("panel.variante.stockLinea", {
          stock: variant.onHand,
          reservados: variant.heldQty,
          disponibles: variant.available,
        })}
        {variant.isActive ? "" : t("panel.variante.inactiva")}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
          {editing ? t("panel.variante.cancelar") : t("panel.variante.editar")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setAdjusting((v) => !v)}>
          {adjusting ? t("panel.variante.cancelar") : t("panel.variante.ajustarStock")}
        </Button>
      </div>

      {editing ? (
        <div className="mt-3">
          <VariantFields
            productId={productId}
            variant={variant}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : null}

      {adjusting ? (
        <div className="mt-3">
          <StockAdjustForm
            productId={productId}
            variantId={variant.id}
            onDone={() => setAdjusting(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function VariantFields({
  productId,
  variant,
  onDone,
}: {
  productId: number;
  variant?: VariantCard;
  onDone: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="border-border grid gap-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        const compareAt = String(data.get("compareAtPyg") ?? "").trim();

        const reorderPointRaw = String(data.get("reorderPoint") ?? "").trim();

        startTransition(async () => {
          const result = await saveProductVariant({
            productId,
            variantId: variant?.id,
            sku: String(data.get("sku") ?? ""),
            label: String(data.get("label") ?? ""),
            pricePyg: Number(data.get("pricePyg")),
            compareAtPyg: compareAt === "" ? null : Number(compareAt),
            isActive: data.get("isActive") === "on",
            reorderPoint: reorderPointRaw === "" ? null : Number(reorderPointRaw),
          });

          if (!result.ok) {
            setError(result.error);
            return;
          }
          toast.success(t("panel.variante.guardada"));
          onDone();
          router.refresh();
        });
      }}
    >
      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border p-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`label-${variant?.id ?? "new"}`}>{t("panel.variante.etiqueta")}</Label>
          <Input
            id={`label-${variant?.id ?? "new"}`}
            name="label"
            required
            defaultValue={variant?.label ?? ""}
            placeholder={t("panel.variante.etiqueta.placeholder")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`sku-${variant?.id ?? "new"}`}>{t("panel.variante.sku")}</Label>
          <Input
            id={`sku-${variant?.id ?? "new"}`}
            name="sku"
            required
            defaultValue={variant?.sku ?? ""}
            placeholder={t("panel.variante.sku.placeholder")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`price-${variant?.id ?? "new"}`}>{t("panel.variante.precio")}</Label>
          <Input
            id={`price-${variant?.id ?? "new"}`}
            name="pricePyg"
            required
            type="number"
            min={0}
            // step=1: guaraníes enteros. Sin esto el navegador acepta 1500.5 y
            // el error recién aparece del lado del servidor.
            step={1}
            inputMode="numeric"
            defaultValue={variant?.pricePyg ?? ""}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`compare-${variant?.id ?? "new"}`}>{t("panel.variante.precioTachado")}</Label>
          <Input
            id={`compare-${variant?.id ?? "new"}`}
            name="compareAtPyg"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            defaultValue={variant?.compareAtPyg ?? ""}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`reorder-${variant?.id ?? "new"}`}>{t("panel.variante.puntoReposicion")}</Label>
          <Input
            id={`reorder-${variant?.id ?? "new"}`}
            name="reorderPoint"
            type="number"
            min={0}
            max={100_000}
            step={1}
            inputMode="numeric"
            data-testid={TESTIDS.adminVariantReorderPoint}
            placeholder={t("panel.variante.puntoReposicion.placeholder")}
            defaultValue={variant?.reorderPoint ?? ""}
          />
          <p className="text-muted-foreground text-xs">
            {t("panel.variante.puntoReposicion.ayuda")}
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={variant?.isActive ?? true} />
        {t("panel.variante.activa")}
      </label>

      {variant === undefined ? (
        <p className="text-muted-foreground text-xs">{t("panel.variante.arrancaEnCero")}</p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? t("panel.acciones.guardando") : t("panel.variante.guardar")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone} disabled={isPending}>
          {t("panel.variante.cancelar")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Ajuste de stock. Se manda un delta (+/−) y no un total nuevo: dos conteos
 * simultáneos con "poné 7" se pisan; dos "sumá 3" se suman. El motivo es
 * obligatorio y queda auditado en `stock_adjustments`.
 */
function StockAdjustForm({
  productId,
  variantId,
  onDone,
}: {
  productId: number;
  variantId: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sign, setSign] = useState<1 | -1>(1);

  return (
    <form
      className="border-border grid gap-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        const qty = Math.abs(Number(data.get("qty")));

        startTransition(async () => {
          const result = await adjustVariantStock({
            variantId,
            productId,
            delta: sign * qty,
            reason: String(data.get("reason") ?? ""),
          });

          if (!result.ok) {
            setError(result.error);
            return;
          }
          toast.success(t("panel.stock.ajustado", { n: result.newOnHand }));
          onDone();
          router.refresh();
        });
      }}
    >
      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border p-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={sign === 1 ? "default" : "outline"}
          onClick={() => setSign(1)}
        >
          {t("panel.stock.agregar")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={sign === -1 ? "default" : "outline"}
          onClick={() => setSign(-1)}
        >
          {t("panel.stock.quitar")}
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`qty-${variantId}`}>{t("panel.stock.cantidad")}</Label>
        <Input
          id={`qty-${variantId}`}
          name="qty"
          type="number"
          min={1}
          step={1}
          required
          inputMode="numeric"
          defaultValue={1}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`reason-${variantId}`}>{t("panel.stock.motivo")}</Label>
        <Input
          id={`reason-${variantId}`}
          name="reason"
          required
          minLength={4}
          maxLength={300}
          placeholder={t("panel.stock.motivo.placeholder")}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? t("panel.acciones.guardando") : t("panel.variante.ajustarStock")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone} disabled={isPending}>
          {t("panel.variante.cancelar")}
        </Button>
      </div>
    </form>
  );
}
