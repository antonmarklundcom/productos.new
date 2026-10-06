"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { editPendingOrderAction } from "@/app/actions/admin-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatGs } from "@/lib/money";
import { waLink } from "@/lib/py";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

export type EditOrderItemView = {
  orderItemId: number;
  nameSnapshot: string;
  /** La cantidad actual del pedido — el techo: acá sólo se baja o se quita. */
  qty: number;
};

/**
 * Editar un pedido que todavía no se pagó (O16 dejó el dominio; esto es la
 * piel, plan §6.1 D).
 *
 * El navegador nunca calcula ni muestra un total propio: manda ids, cantidades,
 * dirección y método, y el resumen "total antes → después" que se ve acá abajo
 * es literalmente lo que devolvió `editPendingOrderAction` — nunca una cuenta
 * hecha con `formatGs(qty * unitPricePyg)` de este lado.
 */
export function EditOrderForm({
  orderId,
  customerPhone,
  items,
  shipCity,
  shipAddress,
  shipReference,
  shippingMethods,
  currentShippingMethodId,
}: {
  orderId: number;
  customerPhone: string;
  items: EditOrderItemView[];
  shipCity: string;
  shipAddress: string;
  shipReference: string | null;
  /** Ya filtrados por activo + medio de pago del pedido (la page decide eso). */
  shippingMethods: Array<{ id: number; name: string }>;
  currentShippingMethodId: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Colapsado por default: la ficha del pedido ya tiene mucho para leer antes
  // de llegar acá, y editar es la excepción, no lo primero que se hace al
  // abrir un pedido pendiente de pago.
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<number, number>>(() =>
    Object.fromEntries(items.map((item) => [item.orderItemId, item.qty])),
  );
  const [city, setCity] = useState(shipCity);
  const [address, setAddress] = useState(shipAddress);
  const [reference, setReference] = useState(shipReference ?? "");
  const initialMethod =
    currentShippingMethodId !== null &&
    shippingMethods.some((method) => method.id === currentShippingMethodId)
      ? String(currentShippingMethodId)
      : (shippingMethods[0] ? String(shippingMethods[0].id) : "");
  const [shippingMethodId, setShippingMethodId] = useState(initialMethod);
  const [reason, setReason] = useState("");

  // El resultado de la acción, tal cual vino del servidor — es lo único que
  // se muestra como "total nuevo" (regla del plan: nada de plata calculada
  // en el navegador).
  type EditResult = Awaited<ReturnType<typeof editPendingOrderAction>>;
  const [resultado, setResultado] = useState<Extract<EditResult, { ok: true }> | null>(null);

  const whatsappHref = (() => {
    if (!resultado) return null;
    try {
      return waLink(customerPhone, resultado.whatsapp);
    } catch {
      return null;
    }
  })();

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        data-testid={TESTIDS.adminEditOrderOpen}
        onClick={() => setOpen(true)}
      >
        {t("panel.pedido.editar.abrir")}
      </Button>
    );
  }

  return (
    <div className="border-border grid gap-4 rounded-xl border p-4">
      {error ? (
        <p role="alert" className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      {resultado ? (
        <div
          data-testid={TESTIDS.adminEditOrderResult}
          className="border-border bg-muted/40 grid gap-2 rounded-lg border p-3 text-sm"
        >
          <p className="font-medium">
            {t("panel.pedido.editar.resumen", {
              antes: formatGs(resultado.resultado.previousTotalPyg),
              despues: formatGs(resultado.resultado.totalPyg),
            })}
          </p>
          {resultado.resultado.couponRemoved ? (
            <p data-testid={TESTIDS.adminEditOrderCuponQuitado} className="text-muted-foreground text-xs">
              {t("panel.pedido.editar.cuponQuitado", {
                codigo: resultado.resultado.removedCouponCode ?? "",
              })}
            </p>
          ) : null}
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={TESTIDS.adminEditOrderWhatsapp}
              className="border-border w-fit rounded-lg border px-3 py-1.5 text-sm font-medium"
            >
              {t("panel.pedido.editar.avisar")}
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2">
        <h3 className="text-sm font-medium">{t("panel.pedido.editar.items")}</h3>
        {items.map((item) => (
          <div key={item.orderItemId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1">{item.nameSnapshot}</span>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={item.qty}
                step={1}
                inputMode="numeric"
                className="w-20"
                data-testid={TESTIDS.adminEditOrderQty}
                data-order-item-id={item.orderItemId}
                value={qty[item.orderItemId] ?? item.qty}
                onChange={(event) => {
                  const next = Math.max(0, Math.min(item.qty, Math.round(Number(event.target.value) || 0)));
                  setQty((prev) => ({ ...prev, [item.orderItemId]: next }));
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={qty[item.orderItemId] === 0}
                onClick={() => setQty((prev) => ({ ...prev, [item.orderItemId]: 0 }))}
              >
                {t("panel.pedido.editar.quitar")}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="edit-order-city">{t("panel.pedido.editar.ciudad")}</Label>
          <Input id="edit-order-city" value={city} maxLength={120} onChange={(event) => setCity(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit-order-address">{t("panel.pedido.editar.direccion")}</Label>
          <Input
            id="edit-order-address"
            value={address}
            maxLength={255}
            onChange={(event) => setAddress(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="edit-order-reference">{t("panel.pedido.editar.referencia")}</Label>
          <Input
            id="edit-order-reference"
            value={reference}
            maxLength={255}
            onChange={(event) => setReference(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="edit-order-shipping">{t("panel.pedido.editar.envio")}</Label>
          {shippingMethods.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t("panel.pedido.editar.sinEnvios")}</p>
          ) : (
            <select
              id="edit-order-shipping"
              value={shippingMethodId}
              onChange={(event) => setShippingMethodId(event.target.value)}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            >
              {shippingMethods.map((method) => (
                <option key={method.id} value={String(method.id)}>
                  {method.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="edit-order-reason">{t("panel.pedido.editar.motivo")}</Label>
        <Input
          id="edit-order-reason"
          data-testid={TESTIDS.adminEditOrderReason}
          value={reason}
          minLength={5}
          maxLength={500}
          placeholder={t("panel.pedido.editar.motivo.placeholder")}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>

      <div>
        <Button
          type="button"
          data-testid={TESTIDS.adminEditOrderSubmit}
          disabled={isPending}
          onClick={() => {
            setError(null);
            if (reason.trim().length < 5) {
              setError(t("panel.pedido.editar.motivoCorto"));
              return;
            }
            startTransition(async () => {
              const result = await editPendingOrderAction({
                orderId,
                items: items.map((item) => ({
                  orderItemId: item.orderItemId,
                  qty: qty[item.orderItemId] ?? item.qty,
                })),
                shipping: {
                  city: city.trim(),
                  address: address.trim(),
                  reference: reference.trim() || null,
                  shippingMethodId: shippingMethodId === "" ? null : Number(shippingMethodId),
                },
                reason: reason.trim(),
              });

              if (!result.ok) {
                setError(result.error);
                return;
              }

              setResultado(result);
              toast.success(t("panel.pedido.editar.guardado"));
              router.refresh();
            });
          }}
        >
          {isPending ? t("panel.acciones.guardando") : t("panel.pedido.editar.guardar")}
        </Button>
      </div>
    </div>
  );
}
