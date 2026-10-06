import type { Metadata } from "next";
import Link from "next/link";

import { ReviewsManager } from "@/components/admin/reviews-manager";
import { REVIEW_STATUSES, type ReviewStatus } from "@/db/schema";
import { listReviewsForAdmin } from "@/domain/reviews";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { formatDateTimePY } from "@/lib/py";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("panel.resenas.meta") };

export const dynamic = "force-dynamic";

const TAB_LABEL: Record<ReviewStatus, string> = {
  pending: t("panel.resenas.estado.pendiente"),
  approved: t("panel.resenas.estado.aprobada"),
  rejected: t("panel.resenas.estado.rechazada"),
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * `/admin/resenas` — moderar y responder. Owner y staff (capability `resenas`).
 *
 * Por defecto abre en "Por revisar": es la pregunta con la que se entra. La
 * pantalla no tiene ningún campo para cambiar estrellas ni texto de una
 * compradora, y la acción tampoco (ver `src/domain/reviews.ts`).
 */
export default async function AdminReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireCapabilityPage("resenas");
  const query = await searchParams;
  const raw = Array.isArray(query.estado) ? query.estado[0] : query.estado;
  const status: ReviewStatus = (REVIEW_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as ReviewStatus)
    : "pending";

  const reviews = await listReviewsForAdmin({ status });

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{t("panel.resenas.titulo")}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{t("panel.resenas.bajada")}</p>

      <nav className="mt-4 flex flex-wrap gap-2 text-sm">
        {REVIEW_STATUSES.map((tab) => (
          <Link
            key={tab}
            href={tab === "pending" ? "/admin/resenas" : `/admin/resenas?estado=${tab}`}
            aria-current={tab === status ? "page" : undefined}
            className={cn(
              "border-border rounded-lg border px-3 py-1.5",
              tab === status ? "bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {TAB_LABEL[tab]}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        <ReviewsManager
          reviews={reviews.map((review) => ({
            id: review.id,
            status: review.status,
            rating: review.rating,
            title: review.title,
            body: review.body,
            authorName: review.authorName,
            productName: review.productName,
            productSlug: review.productSlug,
            orderId: review.orderId,
            orderNumber: review.orderNumber,
            createdAt: formatDateTimePY(review.createdAt),
            ownerReply: review.ownerReply,
          }))}
        />
      </div>
    </div>
  );
}
