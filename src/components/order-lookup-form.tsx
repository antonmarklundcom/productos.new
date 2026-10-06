"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { lookupOrder } from "@/app/actions/order-lookup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n/client";

export function OrderLookupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await lookupOrder({
            orderNumber: String(data.get("orderNumber") ?? ""),
            phone: String(data.get("phone") ?? ""),
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          if ("redirectTo" in result) router.push(result.redirectTo);
          else setMessage(result.message);
        });
      }}
    >
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor="orderNumber">{t("buscarPedido.numero")}</Label>
        <Input
          id="orderNumber"
          name="orderNumber"
          required
          placeholder={t("buscarPedido.numero.placeholder")}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="phone">{t("buscarPedido.telefono")}</Label>
        <Input
          id="phone"
          name="phone"
          required
          placeholder={t("checkout.whatsapp.placeholder")}
          inputMode="tel"
        />
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? t("buscarPedido.buscando") : t("buscarPedido.boton")}
      </Button>
    </form>
  );
}
