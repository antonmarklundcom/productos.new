"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { uploadReceipt } from "@/app/actions/receipt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n/client";
import { RECEIPT_MAX_BYTES } from "@/lib/upload-limits";

export function ReceiptUpload({
  orderNumber,
  token,
  remaining,
}: {
  orderNumber: string;
  token: string;
  remaining: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (remaining <= 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {t("pedido.subirComprobante.maximo")}
      </p>
    );
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const form = event.currentTarget;
        const data = new FormData(form);
        data.set("orderNumber", orderNumber);
        data.set("token", token);

        // El servidor lo vuelve a validar (`validateReceipt`); esto es para no
        // mandar 20 MB por un 3G para recibir el mismo "no".
        const file = data.get("file");
        if (file instanceof File && file.size > RECEIPT_MAX_BYTES) {
          setError(t("error.comprobante.pesado"));
          return;
        }

        startTransition(async () => {
          let result;
          try {
            result = await uploadReceipt(data);
          } catch {
            // Un corte de red o un 413 no pasa por el `return` de la acción:
            // sin esto, la compradora caía en la pantalla de error del sitio.
            setError(t("error.comprobante.generico"));
            return;
          }
          if (!result.ok) {
            setError(result.error);
            return;
          }
          form.reset();
          toast.success(t("pedido.subirComprobante.recibido"));
          router.refresh();
        });
      }}
    >
      {error ? (
        <p className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor="file">{t("pedido.subirComprobante.campo")}</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          required
        />
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending
          ? t("pedido.subirComprobante.enviando")
          : t("pedido.subirComprobante.enviar")}
      </Button>
    </form>
  );
}
