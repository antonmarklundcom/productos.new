"use client";

import { useRouter } from "next/navigation";
import {
  browserOperation,
  finishBrowserOperation,
} from "@/lib/browser-operation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { registrarDevolucion } from "@/app/actions/admin-returns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

const REASON_MAX = 500;

export type ReturnFormLine = {
  orderItemId: number;
  name: string;
  ordered: number;
  /** Lo que todavía se puede devolver de esta línea (pedido − ya devuelto). */
  remaining: number;
};

/**
 * Registrar qué volvió de un pedido (`src/domain/returns.ts`).
 *
 * Una fila por línea del pedido: cuántas vuelven (0..lo que queda) y si
 * vuelven al stock, marcado por defecto. El tope del input es comodidad: el
 * servidor recalcula lo que queda con el pedido bloqueado, así que dos
 * pestañas abiertas no devuelven la misma remera dos veces.
 */
export function ReturnForm({
  orderId,
  lines,
}: {
  orderId: number;
  lines: ReturnFormLine[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [restock, setRestock] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const devolvibles = lines.filter((line) => line.remaining > 0);
  if (devolvibles.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {t("panel.pedido.devoluciones.nadaQueDevolver")}
      </p>
    );
  }

  const total = devolvibles.reduce(
    (sum, line) => sum + (qty[line.orderItemId] ?? 0),
    0
  );

  const submit = (): void => {
    setError(null);
    startTransition(async () => {
      const payload = {
        orderId,
        reason,
        items: devolvibles.map((line) => ({
          orderItemId: line.orderItemId,
          qty: qty[line.orderItemId] ?? 0,
          restock: restock[line.orderItemId] ?? true,
        })),
      };
      const operationKey = await browserOperation(`return:${orderId}`, payload);
      const result = await registrarDevolucion({ ...payload, operationKey });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      finishBrowserOperation(`return:${orderId}`);
      setQty({});
      setRestock({});
      setReason("");
      toast.success(t("panel.pedido.devoluciones.registrada"));
      router.refresh();
    });
  };

  return (
    <form
      data-testid={TESTIDS.adminReturnForm}
      className="border-border grid gap-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h3 className="text-sm font-medium">
        {t("panel.pedido.devoluciones.nueva")}
      </h3>

      <ul className="grid gap-2">
        {devolvibles.map((line) => {
          const inputId = `return-qty-${line.orderItemId}`;
          const checkId = `return-restock-${line.orderItemId}`;
          return (
            <li
              key={line.orderItemId}
              className="flex flex-wrap items-center gap-3 text-sm"
            >
              <span className="min-w-0 flex-1">{line.name}</span>
              <span className="flex items-center gap-1.5">
                <Label htmlFor={inputId} className="text-xs">
                  {t("panel.pedido.devoluciones.cantidad")}
                </Label>
                <Input
                  id={inputId}
                  type="number"
                  min={0}
                  max={line.remaining}
                  step={1}
                  inputMode="numeric"
                  data-testid={TESTIDS.adminReturnQty}
                  data-order-item-id={line.orderItemId}
                  value={qty[line.orderItemId] ?? 0}
                  onChange={(event) => {
                    const valor = Math.trunc(Number(event.target.value));
                    const acotado = Number.isFinite(valor)
                      ? Math.max(0, Math.min(line.remaining, valor))
                      : 0;
                    setQty((prev) => ({
                      ...prev,
                      [line.orderItemId]: acotado,
                    }));
                  }}
                  className="w-20"
                />
                <span className="text-muted-foreground text-xs">
                  {t("panel.pedido.devoluciones.deTotal", {
                    n: line.remaining,
                  })}
                </span>
              </span>
              <label
                htmlFor={checkId}
                className="flex items-center gap-1.5 text-xs"
              >
                <input
                  id={checkId}
                  type="checkbox"
                  checked={restock[line.orderItemId] ?? true}
                  onChange={(event) =>
                    setRestock((prev) => ({
                      ...prev,
                      [line.orderItemId]: event.target.checked,
                    }))
                  }
                />
                {t("panel.pedido.devoluciones.alStock")}
              </label>
            </li>
          );
        })}
      </ul>

      <div className="grid gap-1.5">
        <Label htmlFor={`return-reason-${orderId}`}>
          {t("panel.pedido.devoluciones.motivo")}
        </Label>
        <textarea
          id={`return-reason-${orderId}`}
          data-testid={TESTIDS.adminReturnReason}
          value={reason}
          maxLength={REASON_MAX}
          rows={2}
          required
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("panel.pedido.devoluciones.motivoPlaceholder")}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border p-2 text-xs"
        >
          {error}
        </p>
      ) : null}

      <div>
        <Button
          type="submit"
          size="sm"
          data-testid={TESTIDS.adminReturnSubmit}
          disabled={isPending || total === 0 || reason.trim().length === 0}
        >
          {isPending
            ? t("panel.pedido.devoluciones.registrando")
            : t("panel.pedido.devoluciones.registrar")}
        </Button>
      </div>
    </form>
  );
}
