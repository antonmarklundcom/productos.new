"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { decideReceipt, previewReceipt } from "@/app/actions/admin-orders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReceiptReview as ReceiptReviewState } from "@/db/schema";
import { t } from "@/i18n";

type ReceiptCard = {
  id: number;
  mime: string;
  bytes: number;
  review: ReceiptReviewState;
  note: string | null;
  uploadedAt: string;
};

const REVIEW_LABEL: Record<ReceiptReviewState, string> = {
  pending: t("panel.comprobante.pending"),
  approved: t("panel.comprobante.approved"),
  rejected: t("panel.comprobante.rejected"),
};

/**
 * Revisión de comprobantes (PLAN.md 4.4).
 *
 * La imagen no se renderiza sola: la URL firmada se pide recién cuando el
 * dueño toca "Ver". Embeberla en el HTML dejaría un link válido al
 * comprobante bancario de un cliente en la caché del navegador y en el
 * historial.
 */
export function ReceiptReview({ receipts }: { receipts: ReceiptCard[] }) {
  return (
    <ul className="grid gap-3">
      {receipts.map((receipt) => (
        <ReceiptItem key={receipt.id} receipt={receipt} />
      ))}
    </ul>
  );
}

function ReceiptItem({ receipt }: { receipt: ReceiptCard }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const openPreview = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await previewReceipt({ receiptId: receipt.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview({ url: result.url, mime: result.mime });
    });
  };

  const decide = (decision: "approved" | "rejected"): void => {
    setError(null);
    startTransition(async () => {
      const result = await decideReceipt({
        receiptId: receipt.id,
        decision,
        note: note || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRejecting(false);
      setNote("");
      toast.success(
        decision === "approved"
          ? t("panel.comprobante.aprobado")
          : t("panel.comprobante.rechazado"),
      );
      router.refresh();
    });
  };

  return (
    <li className="border-border rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">
          {receipt.uploadedAt}
          <span className="text-muted-foreground">
            {" "}
            · {(receipt.bytes / 1024).toFixed(0)} KB
          </span>
        </span>
        <Badge variant={receipt.review === "pending" ? "default" : "outline"}>
          {REVIEW_LABEL[receipt.review]}
        </Badge>
      </div>

      {receipt.note ? (
        <p className="text-muted-foreground mt-1 text-xs">
          {t("panel.comprobante.motivo", { motivo: receipt.note })}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive mt-2 rounded-lg border p-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={openPreview}>
          {preview ? t("panel.comprobante.actualizar") : t("panel.comprobante.ver")}
        </Button>

        {receipt.review === "pending" ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={() => decide("approved")}
            >
              {t("panel.comprobante.aprobar")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setRejecting((value) => !value)}
            >
              {t("panel.comprobante.rechazar")}
            </Button>
          </>
        ) : null}
      </div>

      {rejecting ? (
        <div className="mt-3 grid gap-2">
          <label className="text-muted-foreground text-xs" htmlFor={`note-${receipt.id}`}>
            {t("panel.comprobante.motivoRechazo")}
          </label>
          <Input
            id={`note-${receipt.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("panel.comprobante.motivoRechazo.placeholder")}
            maxLength={500}
          />
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() => decide("rejected")}
          >
            {isPending ? t("panel.acciones.guardando") : t("panel.comprobante.confirmarRechazo")}
          </Button>
        </div>
      ) : null}

      {preview ? (
        <div className="mt-3">
          {preview.mime === "application/pdf" ? (
            <a
              href={preview.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline"
            >
              {t("panel.comprobante.abrirPdf")}
            </a>
          ) : (
            // `<img>` y no `next/image`: la URL viene firmada y vence en dos
            // minutos, así que el optimizador de Next la cachearía y después
            // serviría un link muerto. Además es un comprobante bancario: no
            // queremos una copia en la caché de imágenes del servidor.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.url}
              alt={t("panel.comprobante.alt")}
              className="border-border max-h-96 w-full rounded-lg border object-contain"
            />
          )}
          <p className="text-muted-foreground mt-1 text-xs">{t("panel.comprobante.linkVence")}</p>
        </div>
      ) : null}
    </li>
  );
}
