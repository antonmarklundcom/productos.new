import { t } from "@/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Estrellas de 0 a 5, sólo para mirar (el selector de la compradora es otro:
 * `review-form.tsx`). SVG propio y no un ícono de librería porque la media
 * estrella —el 4,6 de un promedio— necesita el recorte parcial.
 *
 * El `aria-label` dice el número ("4,6 de 5 estrellas") y los SVG van
 * `aria-hidden`: un lector de pantalla no tiene que contar cinco dibujos.
 * Piel: el color sale de `currentColor`, así que cada tienda lo tiñe con una
 * clase sin tocar este archivo.
 */
export function RatingStars({
  value,
  className,
  size = 16,
}: {
  value: number;
  className?: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(5, value));
  const label = t("estrellas.label", { valor: formatRating(clamped) });

  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-0.5 text-amber-500",
        className
      )}
    >
      {[0, 1, 2, 3, 4].map((index) => {
        const fill = Math.max(0, Math.min(1, clamped - index));
        return <Star key={index} fill={fill} size={size} />;
      })}
    </span>
  );
}

/** "4.6" → "4,6": coma decimal, como se escribe en Paraguay. */
export function formatRating(value: number): string {
  return value.toLocaleString("es-PY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

const STAR_PATH =
  "M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96L12 2.5z";

function Star({ fill, size }: { fill: number; size: number }) {
  const percent = Math.round(fill * 100);
  return (
    <span
      aria-hidden
      className="relative inline-block"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className="absolute inset-0 opacity-30"
      >
        <path d={STAR_PATH} fill="currentColor" />
      </svg>
      {percent > 0 ? (
        <span
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${percent}%` }}
        >
          <svg viewBox="0 0 24 24" width={size} height={size}>
            <path d={STAR_PATH} fill="currentColor" />
          </svg>
        </span>
      ) : null}
    </span>
  );
}
