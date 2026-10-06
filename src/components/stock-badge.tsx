import { Badge } from "@/components/ui/badge";
import { t } from "@/i18n/client";

/** A partir de acá mostramos "últimas unidades" para empujar la decisión. */
export const LOW_STOCK_THRESHOLD = 5;

export function StockBadge({ available }: { available: number }) {
  if (available <= 0) {
    return <Badge variant="destructive">{t("stock.sin")}</Badge>;
  }
  if (available <= LOW_STOCK_THRESHOLD) {
    return (
      <Badge variant="secondary">
        {available === 1
          ? t("stock.ultima")
          : t("stock.quedan", { n: available })}
      </Badge>
    );
  }
  return <Badge variant="outline">{t("stock.disponible")}</Badge>;
}
