"use client";

import {
  browserOperation,
  finishBrowserOperation,
} from "@/lib/browser-operation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { markPaymentRefunded } from "@/app/actions/admin-payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatGs } from "@/lib/money";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

/**
 * Reembolso total o parcial de un pago (O7 §5.3 A, S10 §6.2).
 *
 * **Nueva, la crea S10** (plan-operacion §6.2): componente autónomo y
 * controlado por props, sin ninguna consulta propia — el navegador nunca
 * decide plata (plan-operacion §0.10), así que el monto por defecto sale de
 * lo que ya le pasó quien monta este formulario y el servidor vuelve a leer
 * `amount_pyg`/`refunded_pyg` con la fila bloqueada dentro de `refundPayment`.
 *
 * `refundedPygInicial` es el punto de partida (normalmente 0: un pago recién
 * detectado); el estado de "cuánto queda" se actualiza solo después de cada
 * reembolso exitoso, así que se pueden hacer dos parciales seguidos en la
 * misma pantalla sin volver a pedirle nada al servidor. `onDone` es el
 * callback de quien lo monta (por ejemplo, para refrescar la lista).
 */
export function RefundForm({
  paymentId,
  orderNumber,
  amountPyg,
  refundedPygInicial = 0,
  allowSettled = false,
  onDone,
}: {
  paymentId: number;
  orderNumber: string;
  amountPyg: number;
  refundedPygInicial?: number;
  allowSettled?: boolean;
  onDone?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [refundedPyg, setRefundedPyg] = useState(refundedPygInicial);
  const resto = Math.max(0, amountPyg - refundedPyg);
  const [amount, setAmount] = useState(String(resto));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const disabled = resto <= 0;

  return (
    <div className="border-border grid gap-3 rounded-lg border p-3">
      <h3 className="text-sm font-medium">{t("panel.reembolso.titulo")}</h3>
      <dl className="grid grid-cols-2 gap-1 text-xs">
        <dt className="text-muted-foreground">{t("panel.reembolso.pagado")}</dt>
        <dd className="text-right tabular-nums">{formatGs(amountPyg)}</dd>
        <dt className="text-muted-foreground">
          {t("panel.reembolso.devuelto")}
        </dt>
        <dd className="text-right tabular-nums">{formatGs(refundedPyg)}</dd>
        <dt className="font-medium">{t("panel.reembolso.resta")}</dt>
        <dd className="text-right font-semibold tabular-nums">
          {formatGs(resto)}
        </dd>
      </dl>

      {disabled ? (
        <p className="text-muted-foreground text-xs">
          {t("panel.reembolso.completo")}
        </p>
      ) : (
        <>
          {error ? (
            <p
              role="alert"
              className="border-destructive/40 text-destructive rounded-lg border p-2 text-xs"
            >
              {error}
            </p>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor={`refund-amount-${paymentId}`}>
              {t("panel.reembolso.monto")}
            </Label>
            <Input
              id={`refund-amount-${paymentId}`}
              type="number"
              min={1}
              max={resto}
              step={1}
              inputMode="numeric"
              data-testid={TESTIDS.adminRefundAmount}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`refund-reason-${paymentId}`}>
              {t("panel.reembolso.motivo")}
            </Label>
            <Input
              id={`refund-reason-${paymentId}`}
              data-testid={TESTIDS.adminRefundReason}
              value={reason}
              maxLength={500}
              placeholder={t("panel.reembolso.motivo.placeholder")}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              data-testid={TESTIDS.adminRefundConfirm}
              disabled={isPending}
              onClick={() => {
                setError(null);
                const monto = Math.round(Number(amount));
                if (!Number.isInteger(monto) || monto <= 0) {
                  setError(t("adminForm.precioEntero"));
                  return;
                }
                if (monto > resto) {
                  setError(t("panel.reembolso.excede"));
                  return;
                }
                startTransition(async () => {
                  const payload = {
                    paymentId,
                    reason,
                    amountPyg: monto,
                    allowSettled,
                  };
                  const operationKey = await browserOperation(
                    `refund:${paymentId}`,
                    payload
                  );
                  const result = await markPaymentRefunded({
                    ...payload,
                    operationKey,
                  });
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  finishBrowserOperation(`refund:${paymentId}`);
                  const nuevoDevuelto =
                    result.refundedPyg ?? refundedPyg + monto;
                  setRefundedPyg(nuevoDevuelto);
                  setAmount(String(Math.max(0, amountPyg - nuevoDevuelto)));
                  setReason("");
                  toast.success(
                    `${t("panel.reembolso.hecho")} · ${orderNumber}`
                  );
                  onDone?.();
                });
              }}
            >
              {isPending
                ? t("panel.acciones.guardando")
                : t("panel.reembolso.confirmar")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
