"use client";

import { useState } from "react";

import { subscribeToStockAlert } from "@/app/actions/stock-alerts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n/client";
import { TESTIDS } from "@/lib/testids";

/**
 * "Avisame cuando haya stock" (plan-operacion §6.3 / §5.2 E).
 *
 * Quien la dibuja (`add-to-cart.tsx`) ya hizo las dos comprobaciones: la
 * variante elegida no tiene disponibilidad, y la page le pasó
 * `stockAlertsEnabled()` en `true`. Este componente no vuelve a decidir nada
 * de eso — sólo manda variante + teléfono a la acción del servidor
 * (`subscribeToStockAlert`), que es quien relee stock y flag antes de
 * guardar nada. El navegador nunca decide si la feature está prendida.
 */
export function StockAlertForm({ variantId }: { variantId: number }) {
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle"
  );
  const [error, setError] = useState("");

  if (status === "done") {
    return (
      <p className="text-muted-foreground mt-3 text-sm">
        {t("stock.avisame.listo")}
      </p>
    );
  }

  return (
    <form
      data-testid={TESTIDS.stockAlertForm}
      className="mt-3 space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setStatus("loading");
        setError("");
        const result = await subscribeToStockAlert({ variantId, phone });
        if (result.ok) {
          setStatus("done");
        } else {
          setStatus("error");
          setError(result.error);
        }
      }}
    >
      <p className="text-sm font-medium">{t("stock.avisame.titulo")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="stockAlertPhone">{t("stock.avisame.label")}</Label>
          <Input
            id="stockAlertPhone"
            name="stockAlertPhone"
            data-testid={TESTIDS.stockAlertPhone}
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder={t("checkout.whatsapp.placeholder")}
            inputMode="tel"
            autoComplete="tel"
          />
        </div>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={status === "loading"}
          data-testid={TESTIDS.stockAlertSubmit}
        >
          {status === "loading"
            ? t("stock.avisame.enviando")
            : t("stock.avisame.boton")}
        </Button>
        {error ? (
          <p className="text-destructive basis-full text-sm">{error}</p>
        ) : null}
      </div>
    </form>
  );
}
