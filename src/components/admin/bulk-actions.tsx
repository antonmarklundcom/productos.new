"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  bulkMoveProductsCategory,
  bulkSetProductsActive,
  duplicateProductAction,
} from "@/app/actions/admin-products";
import { BulkPriceDialog } from "@/components/admin/bulk-price-dialog";
import { Button } from "@/components/ui/button";
import { TESTIDS } from "@/lib/testids";
import { t, tPlural } from "@/i18n";

/**
 * Acciones masivas sobre productos elegidos en `product-list.tsx` (O7 §5.3 B).
 *
 * Activar, desactivar y mover de categoría son `productos` (staff): trabajo
 * de catálogo de todos los días. El ajuste de precios ni siquiera se ofrece
 * acá si `canBulkPrice` es falso — es owner-only y "nada se dibuja para un
 * rol que el guard rechazaría" (plan-operacion §6.2).
 */
export function BulkActionsBar({
  productIds,
  categories,
  canBulkPrice,
  onDone,
}: {
  productIds: number[];
  categories: Array<{ id: number; name: string }>;
  canBulkPrice: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setActive = (isActive: boolean): void => {
    setError(null);
    startTransition(async () => {
      const result = await bulkSetProductsActive({ productIds, isActive });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(tPlural("panel.masivo.cambiaronActivos", result.afectados));
      onDone();
      router.refresh();
    });
  };

  const moveCategory = (): void => {
    if (!categoryId) return;
    setError(null);
    startTransition(async () => {
      const result = await bulkMoveProductsCategory({
        productIds,
        categoryId: Number(categoryId),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(tPlural("panel.masivo.movieron", result.afectados));
      setCategoryId("");
      onDone();
      router.refresh();
    });
  };

  return (
    <div
      data-testid={TESTIDS.adminBulkBar}
      className="border-border bg-muted/40 mt-4 grid gap-3 rounded-xl border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {tPlural("panel.productos.seleccionados", productIds.length)}
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={isPending}>
          {t("panel.productos.limpiarSeleccion")}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="border-destructive/40 text-destructive rounded-lg border p-2 text-xs">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid={TESTIDS.adminBulkActivate}
          disabled={isPending}
          onClick={() => setActive(true)}
        >
          {isPending ? t("panel.masivo.aplicando") : t("panel.masivo.activar")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid={TESTIDS.adminBulkDeactivate}
          disabled={isPending}
          onClick={() => setActive(false)}
        >
          {isPending ? t("panel.masivo.aplicando") : t("panel.masivo.desactivar")}
        </Button>

        <select
          data-testid={TESTIDS.adminBulkMoveCategorySelect}
          aria-label={t("panel.masivo.moverCategoria")}
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          disabled={isPending}
        >
          <option value="">{t("panel.masivo.elegiCategoria")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid={TESTIDS.adminBulkMoveCategoryConfirm}
          disabled={isPending || !categoryId}
          onClick={moveCategory}
        >
          {t("panel.masivo.moverConfirmar")}
        </Button>

        {canBulkPrice ? (
          <BulkPriceDialog
            productIds={productIds}
            onApplied={() => {
              onDone();
              router.refresh();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Duplicar un producto desde su ficha (O7 §5.3 C). `staff`, la misma
 * capacidad que ya gobierna el resto de la página — el guard real vive en
 * `duplicateProductAction`.
 */
export function DuplicateProductButton({ productId }: { productId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-1">
      {error ? (
        <p role="alert" className="border-destructive/40 text-destructive text-xs">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={TESTIDS.adminProductDuplicate}
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await duplicateProductAction({ productId });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            toast.success(t("panel.producto.duplicado"));
            router.push(`/admin/productos/${result.productId}`);
          });
        }}
      >
        {isPending ? t("panel.producto.duplicando") : t("panel.producto.duplicar")}
      </Button>
    </div>
  );
}
