"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { markPaymentRefunded, retryPaymentRevival } from "@/app/actions/admin-payments";
import { RefundForm } from "@/components/admin/refund-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatGs } from "@/lib/money";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

/**
 * "Pagos sin pedido vivo" con sus dos acciones (ARCH.md §4.1).
 *
 * La lista sola dejaba al dueño mirando plata que no podía tocar: para revivir
 * un pedido o anotar una devolución había que entrar a MySQL. Los dos botones
 * son eso, y nada más que eso — el servidor vuelve a leer el estado con el
 * candado tomado, así que un click sobre una pantalla vieja no decide nada.
 *
 * "Devolver" pide un motivo y confirma: es la única de las dos que no se
 * deshace. "Reintentar" es seguro de tocar tantas veces como haga falta.
 */

export type UnmatchedPaymentCard = {
  paymentId: number;
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  provider: string;
  amountPyg: number;
  paidAt: string;
  // == S17 == `findUnmatchedPayments` (O14) ya trae el reembolso real.
  refundedPyg: number;
};

/**
 * `puedeDevolver` lo decide la página con la matriz de roles: registrar una
 * devolución es owner-only (ARCH.md §1). Esconder el botón es UX —el guard de
 * `markPaymentRefunded` es lo que frena la escritura—, pero un botón que
 * siempre contesta 403 es peor que no tenerlo.
 */
export function UnmatchedPayments({
  payments,
  puedeDevolver,
}: {
  payments: UnmatchedPaymentCard[];
  puedeDevolver: boolean;
}) {
  return (
    <ul className="divide-border mt-3 divide-y text-sm">
      {payments.map((payment) => (
        <UnmatchedPaymentRow
          key={payment.paymentId}
          payment={payment}
          puedeDevolver={puedeDevolver}
        />
      ))}
    </ul>
  );
}

function UnmatchedPaymentRow({
  payment,
  puedeDevolver,
}: {
  payment: UnmatchedPaymentCard;
  puedeDevolver: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refunding, setRefunding] = useState(false);
  // Reembolso parcial (O7/S10, plan-operacion §6.2): un formulario aparte,
  // que la propia S10 crea (`refund-form.tsx`) — no toca el flujo de arriba,
  // que sigue siendo la devolución total de siempre.
  const [refundingParcial, setRefundingParcial] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const retry = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await retryPaymentRevival({
        paymentId: payment.paymentId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        result.changed
          ? t("panel.pagos.revivido", { numero: result.orderNumber })
          : t("panel.pagos.yaCobrado", { numero: result.orderNumber })
      );
      router.refresh();
    });
  };

  const refund = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await markPaymentRefunded({
        paymentId: payment.paymentId,
        reason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRefunding(false);
      setReason("");
      toast.success(t("panel.pagos.devolucionAnotada", { numero: result.orderNumber }));
      router.refresh();
    });
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/admin/pedidos/${payment.orderId}`} className="font-medium underline">
          {payment.orderNumber}
        </Link>
        <span className="font-semibold tabular-nums">{formatGs(payment.amountPyg)}</span>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        {t("panel.pagos.detalle", {
          proveedor: payment.provider,
          estado: payment.orderStatus,
          fecha: payment.paidAt,
        })}
      </p>

      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive mt-2 rounded-lg border p-2 text-xs"
        >
          {error}
        </p>
      ) : null}

      {refundingParcial && puedeDevolver ? (
        <div className="mt-2">
          <RefundForm
            paymentId={payment.paymentId}
            orderNumber={payment.orderNumber}
            amountPyg={payment.amountPyg}
            // == S17 == Real desde `findUnmatchedPayments` (O14 agregó
            // `refunded_pyg` a la consulta); antes esto era 0 siempre.
            refundedPygInicial={payment.refundedPyg}
            onDone={() => router.refresh()}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={isPending}
            onClick={() => setRefundingParcial(false)}
          >
            {t("panel.reembolso.cancelar")}
          </Button>
        </div>
      ) : null}

      {refunding && puedeDevolver ? (
        <div className="border-border mt-2 grid gap-2 rounded-lg border p-3">
          <label className="text-muted-foreground text-xs" htmlFor={`motivo-${payment.paymentId}`}>
            {t("panel.pagos.motivo")}
          </label>
          <Input
            id={`motivo-${payment.paymentId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("panel.pagos.motivo.placeholder")}
            maxLength={500}
          />
          <p className="text-muted-foreground text-xs">{t("panel.pagos.aclaracion")}</p>
          <div className="flex gap-2">
            <Button type="button" variant="destructive" disabled={isPending} onClick={refund}>
              {isPending ? t("panel.acciones.guardando") : t("panel.pagos.confirmarDevolucion")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => {
                setRefunding(false);
                setReason("");
              }}
            >
              {t("panel.acciones.volver")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={isPending} onClick={retry}>
            {t("panel.pagos.reintentar")}
          </Button>
          {puedeDevolver ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setRefunding(true)}
            >
              {t("panel.pagos.marcarDevuelto")}
            </Button>
          ) : null}
          {puedeDevolver ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid={TESTIDS.adminRefundOpen}
              disabled={isPending}
              onClick={() => setRefundingParcial(true)}
            >
              {t("panel.reembolso.abrir")}
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}
