"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { moderarResena, responderResena } from "@/app/actions/admin-reviews";
import { RatingStars } from "@/components/rating-stars";
import { Button } from "@/components/ui/button";
import type { ReviewStatus } from "@/db/schema";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

const REPLY_MAX = 2000;

export type AdminReviewView = {
  id: number;
  status: ReviewStatus;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  productName: string;
  productSlug: string;
  orderId: number;
  orderNumber: string;
  /** Ya formateada en hora de Asunción. */
  createdAt: string;
  ownerReply: string | null;
};

/**
 * La lista de `/admin/resenas`. Estrellas, título y texto se **muestran**, no
 * se editan: lo único que escribe el panel es el estado y la respuesta.
 */
export function ReviewsManager({ reviews }: { reviews: AdminReviewView[] }) {
  if (reviews.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("panel.resenas.vacio")}</p>;
  }

  return (
    <ul className="grid gap-4">
      {reviews.map((review) => (
        <ReviewRow key={review.id} review={review} />
      ))}
    </ul>
  );
}

function ReviewRow({ review }: { review: AdminReviewView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reply, setReply] = useState(review.ownerReply ?? "");
  const [error, setError] = useState<string | null>(null);

  const moderar = (status: "approved" | "rejected"): void => {
    setError(null);
    startTransition(async () => {
      const result = await moderarResena({ id: review.id, status });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(status === "approved" ? t("panel.resenas.aprobada") : t("panel.resenas.rechazada"));
      router.refresh();
    });
  };

  const responder = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await responderResena({ id: review.id, reply: reply.trim() || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(t("panel.resenas.respuestaGuardada"));
      router.refresh();
    });
  };

  return (
    <li
      data-testid={TESTIDS.adminReviewRow}
      data-review-id={review.id}
      className="border-border grid gap-2 rounded-lg border p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/producto/${review.productSlug}`} className="font-medium underline" target="_blank">
          {review.productName}
        </Link>
        <RatingStars value={review.rating} />
      </div>
      {review.title ? <p className="font-medium">{review.title}</p> : null}
      <p className="whitespace-pre-line">{review.body}</p>
      <p className="text-muted-foreground text-xs">
        {review.authorName} · {review.createdAt} ·{" "}
        <Link href={`/admin/pedidos/${review.orderId}`} className="underline">
          {t("panel.resenas.pedido", { numero: review.orderNumber })}
        </Link>
      </p>

      {error ? (
        <p role="alert" className="border-destructive/40 text-destructive rounded-lg border p-2 text-xs">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {review.status !== "approved" ? (
          <Button type="button" size="sm" disabled={isPending} onClick={() => moderar("approved")}>
            {t("panel.resenas.aprobar")}
          </Button>
        ) : null}
        {review.status !== "rejected" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => moderar("rejected")}
          >
            {t("panel.resenas.rechazar")}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={`reply-${review.id}`} className="text-xs font-medium">
          {t("panel.resenas.respuesta")}
        </label>
        <textarea
          id={`reply-${review.id}`}
          value={reply}
          maxLength={REPLY_MAX}
          rows={2}
          onChange={(event) => setReply(event.target.value)}
          placeholder={t("panel.resenas.respuestaPlaceholder")}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        <div>
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={responder}>
            {t("panel.resenas.guardarRespuesta")}
          </Button>
        </div>
      </div>
    </li>
  );
}
