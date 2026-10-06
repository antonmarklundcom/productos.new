"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { advanceOrder } from "@/app/actions/admin-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrderStatus } from "@/db/schema";

import { DESTRUCTIVE_TRANSITIONS, ORDER_STATUS_LABEL, TRANSITION_LABEL } from "@/lib/order-labels";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

/**
 * Transiciones que, además de las destructivas, paran en el paso intermedio
 * (plan-operacion §6.1): `enviado` es la única que puede llevar seguimiento,
 * y el paso intermedio es donde se carga. No es una transición destructiva
 * —no borra plata ni stock— así que el botón sigue con el estilo normal.
 */
function needsConfirmStep(status: OrderStatus): boolean {
  return DESTRUCTIVE_TRANSITIONS.includes(status) || status === "enviado";
}

/**
 * Botones de cambio de estado.
 *
 * Sólo se muestran las transiciones que la máquina de estados permite desde
 * el estado actual — pero eso es UX: `transitionOrder` valida la arista otra
 * vez del lado del servidor, así que un botón fabricado a mano no mueve nada.
 */
export function OrderActions({
  orderId,
  nextStatuses,
  courierSuggestions = [],
}: {
  orderId: number;
  nextStatuses: OrderStatus[];
  /**
   * Nombres de los `shipping_methods` de la tienda, para sugerir el courier
   * sin obligar a escribirlo siempre igual — el campo sigue siendo texto
   * libre (una moto propia no es un método de envío cargado).
   */
  courierSuggestions?: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);
  const [reason, setReason] = useState("");
  const [trackingCarrier, setTrackingCarrier] = useState("");
  const [trackingCode, setTrackingCode] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = (to: OrderStatus, why: string): void => {
    setError(null);
    startTransition(async () => {
      const result = await advanceOrder({
        orderId,
        to,
        reason: why || undefined,
        // El tracking sólo tiene sentido con destino `enviado` — el dominio
        // rechaza cualquier otro destino, así que no vale la pena mandarlo
        // si no aplica (ver `OrderTrackingSchema`).
        tracking:
          to === "enviado"
            ? {
                carrier: trackingCarrier.trim() || undefined,
                code: trackingCode.trim() || undefined,
                url: trackingUrl.trim() || undefined,
              }
            : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPendingStatus(null);
      setReason("");
      setTrackingCarrier("");
      setTrackingCode("");
      setTrackingUrl("");
      toast.success(t("panel.acciones.marcado", { estado: ORDER_STATUS_LABEL[to] }));
      router.refresh();
    });
  };

  return (
    <div className="grid gap-3">
      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm"
        >
          {error}
        </p>
      ) : null}

      {/* Un paso intermedio para lo que no se puede deshacer: cancelar un
          pedido con el pulgar en el celular es demasiado fácil. También para
          `enviado`, que es donde se carga el seguimiento del envío. */}
      {pendingStatus ? (
        <div className="border-border grid gap-2 rounded-xl border p-3">
          <p className="text-sm font-medium">{TRANSITION_LABEL[pendingStatus]}</p>
          <label className="text-muted-foreground text-xs" htmlFor="reason">
            {t("panel.acciones.motivo")}
          </label>
          <Input
            id="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("panel.acciones.motivo.placeholder")}
            maxLength={500}
          />

          {pendingStatus === "enviado" ? (
            <div
              className="border-border mt-1 grid gap-2 rounded-lg border border-dashed p-3"
              data-testid={TESTIDS.orderTrackingBlockForm}
            >
              <p className="text-xs font-medium">{t("panel.acciones.tracking.titulo")}</p>
              <div className="grid gap-1.5">
                <Label htmlFor="tracking-carrier">{t("panel.acciones.tracking.courier")}</Label>
                <Input
                  id="tracking-carrier"
                  data-testid={TESTIDS.orderTrackingCarrierInput}
                  list="tracking-courier-suggestions"
                  value={trackingCarrier}
                  onChange={(event) => setTrackingCarrier(event.target.value)}
                  placeholder={t("panel.acciones.tracking.courier.placeholder")}
                  maxLength={80}
                />
                <datalist id="tracking-courier-suggestions">
                  {courierSuggestions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tracking-code">{t("panel.acciones.tracking.guia")}</Label>
                <Input
                  id="tracking-code"
                  data-testid={TESTIDS.orderTrackingCodeInput}
                  value={trackingCode}
                  onChange={(event) => setTrackingCode(event.target.value)}
                  placeholder={t("panel.acciones.tracking.guia.placeholder")}
                  maxLength={120}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tracking-url">{t("panel.acciones.tracking.link")}</Label>
                <Input
                  id="tracking-url"
                  type="url"
                  data-testid={TESTIDS.orderTrackingUrlInput}
                  value={trackingUrl}
                  onChange={(event) => setTrackingUrl(event.target.value)}
                  placeholder={t("panel.acciones.tracking.link.placeholder")}
                  maxLength={500}
                />
              </div>
              <p className="text-muted-foreground text-xs">{t("panel.acciones.tracking.opcional")}</p>
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              data-testid={TESTIDS.orderTransitionConfirm}
              variant={DESTRUCTIVE_TRANSITIONS.includes(pendingStatus) ? "destructive" : "default"}
              disabled={isPending}
              onClick={() => run(pendingStatus, reason)}
            >
              {isPending ? t("panel.acciones.guardando") : t("panel.acciones.confirmar")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => {
                setPendingStatus(null);
                setReason("");
                setTrackingCarrier("");
                setTrackingCode("");
                setTrackingUrl("");
              }}
            >
              {t("panel.acciones.volver")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {nextStatuses.filter((status) => status !== "reembolsado").map((status) => {
            const destructive = DESTRUCTIVE_TRANSITIONS.includes(status);
            return (
              <Button
                key={status}
                type="button"
                data-testid={TESTIDS.orderTransitionButton}
                data-status={status}
                variant={destructive ? "outline" : "default"}
                disabled={isPending}
                onClick={() => (needsConfirmStep(status) ? setPendingStatus(status) : run(status, ""))}
              >
                {TRANSITION_LABEL[status] ?? ORDER_STATUS_LABEL[status]}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
