"use client";

import { catalogCapabilities } from "@/lib/catalog-policy";
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
  expectedRevisions,
  categories,
  canBulkPrice,
  onDone,
}: {
  productIds: number[];
  expectedRevisions: Record<number,number>;
  categories: Array<{ id: number; name: string }>;
  canBulkPrice: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [operations] = useState(() => new Map<string,string>());
  const operationFor=(intent:string)=>{const key=JSON.stringify([intent,productIds,expectedRevisions]);if(!operations.has(key))operations.set(key,crypto.randomUUID());return operations.get(key)!;};
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setActive = (isActive: boolean): void => {
    setError(null);
    startTransition(async () => {
      const result = await bulkSetProductsActive({ productIds, isActive, expectedRevisions, operationId: operationFor("active:"+isActive) }).catch(()=>({ok:false as const,error:"Se interrumpió la conexión. Reintentá la misma acción para consultar el recibo."}));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if ("conflictos" in result && (result.conflictos as number[]).length) setError("No se cambiaron los productos con conflicto: "+(result.conflictos as number[]).join(", "));
      toast.success(tPlural("panel.masivo.cambiaronActivos", result.afectados));
      if (!("conflictos" in result) || !(result.conflictos as number[]).length) onDone();
      router.refresh();
    });
  };

  const moveCategory = (): void => {
    if (!categoryId) return;
    setError(null);
    startTransition(async () => {
      const result = await bulkMoveProductsCategory({
        productIds, expectedRevisions, operationId: operationFor("category:"+categoryId),
        categoryId: Number(categoryId),
      }).catch(()=>({ok:false as const,error:"Se interrumpió la conexión. Reintentá la misma acción para consultar el recibo."}));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if ("conflictos" in result && (result.conflictos as number[]).length) setError("No se cambiaron los productos con conflicto: "+(result.conflictos as number[]).join(", "));
      toast.success(tPlural("panel.masivo.movieron", result.afectados));
      setCategoryId("");
      if (!("conflictos" in result) || !(result.conflictos as number[]).length) onDone();
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

      {!catalogCapabilities.bulkProducts ? <p className="text-muted-foreground text-xs">Las acciones masivas y la duplicación no están habilitadas. Podés editar cada producto individualmente.</p> : null}
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
          disabled={isPending || !catalogCapabilities.bulkProducts}
          onClick={() => setActive(true)}
        >
          {isPending ? t("panel.masivo.aplicando") : t("panel.masivo.activar")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid={TESTIDS.adminBulkDeactivate}
          disabled={isPending || !catalogCapabilities.bulkProducts}
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
          disabled={isPending || !catalogCapabilities.bulkProducts}
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
          disabled={isPending || !categoryId || !catalogCapabilities.bulkProducts}
          onClick={moveCategory}
        >
          {t("panel.masivo.moverConfirmar")}
        </Button>

        {canBulkPrice && catalogCapabilities.bulkPrices ? (
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
export function DuplicateProductButton({ productId, expectedRevision }: { productId: number; expectedRevision:number }) {
  const router = useRouter();
  const [operationId] = useState(() => crypto.randomUUID());
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
        disabled={isPending || !catalogCapabilities.bulkProducts}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await duplicateProductAction({ productId, expectedRevision, operationId }).catch(()=>({ok:false as const,error:"Se interrumpió la conexión. Reintentá Duplicar: el recibo evita otra copia."}));
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
      {!catalogCapabilities.bulkProducts ? <p className="text-muted-foreground text-xs">La duplicación no está habilitada en este catálogo.</p> : null}
    </div>
  );
}
