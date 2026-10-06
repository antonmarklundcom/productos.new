import { t } from "@/i18n/client";
import { formatGs } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Precio en guaraníes. Siempre con la nota de IVA incluido cuando hay lugar:
 * en PY el precio de góndola ya lo trae, y decirlo evita el "¿me sumás el
 * IVA?" en cada conversación de WhatsApp.
 */
export function PriceTag({
  pricePyg,
  compareAtPyg,
  size = "md",
  showIvaNote = false,
  className,
}: {
  pricePyg: number;
  compareAtPyg?: number | null;
  size?: "sm" | "md" | "lg";
  showIvaNote?: boolean;
  className?: string;
}) {
  const hasDiscount = compareAtPyg != null && compareAtPyg > pricePyg;
  const discount = hasDiscount
    ? Math.round(((compareAtPyg - pricePyg) / compareAtPyg) * 100)
    : 0;

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={cn(
            "font-semibold tabular-nums",
            size === "sm" && "text-sm",
            size === "md" && "text-base",
            size === "lg" && "text-2xl"
          )}
        >
          {formatGs(pricePyg)}
        </span>
        {hasDiscount ? (
          <>
            <span className="text-muted-foreground text-sm tabular-nums line-through">
              {formatGs(compareAtPyg)}
            </span>
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              −{discount}%
            </span>
          </>
        ) : null}
      </div>
      {showIvaNote ? (
        <span className="text-muted-foreground text-xs">
          {t("precio.ivaIncluido")}
        </span>
      ) : null}
    </div>
  );
}
