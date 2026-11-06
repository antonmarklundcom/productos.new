import { t } from "@/i18n/client";
import { formatGs } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Precio en guaraníes con el contexto de compra o consulta. */
export function PriceTag({
  pricePyg,
  compareAtPyg,
  size = "md",
  showIvaNote = false,
  indicative = false,
  className,
}: {
  pricePyg: number;
  compareAtPyg?: number | null;
  size?: "sm" | "md" | "lg";
  showIvaNote?: boolean;
  indicative?: boolean;
  className?: string;
}) {
  const hasDiscount = compareAtPyg != null && compareAtPyg > pricePyg;
  const discount = hasDiscount
    ? Math.round(((compareAtPyg - pricePyg) / compareAtPyg) * 100)
    : 0;

  const note = indicative ? t("producto.precioOrientativo") : showIvaNote ? t("precio.ivaIncluido") : null;

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
      {note ? <span className="text-muted-foreground text-xs">{note}</span> : null}
    </div>
  );
}
