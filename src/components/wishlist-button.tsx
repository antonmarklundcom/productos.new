"use client";

import { useSyncExternalStore } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n/client";
import { sendFunnelEvent } from "@/lib/funnel";
import { TESTIDS } from "@/lib/testids";
import { cn } from "@/lib/utils";
import {
  wishlistHas,
  wishlistSubscribe,
  wishlistToggle,
} from "@/lib/wishlist-store";

/**
 * El corazón de favoritos. Dos formas, mismo componente:
 *
 * - `size="icon"`: la burbuja sobre la foto de `product-card.tsx`. Vive
 *   adentro del `<Link>` de la tarjeta, así que el click frena la navegación
 *   (`preventDefault`/`stopPropagation`) — tocar el corazón no tiene que
 *   abrir la ficha.
 * - `size="inline"`: botón con texto, al lado de "Agregar al carrito" en la
 *   ficha de producto.
 *
 * `useSyncExternalStore` y no un `useEffect` con `useState`: el store vive en
 * `localStorage` y no existe en el servidor, así que el snapshot del servidor
 * (`false`) y el primer render del cliente coinciden — mismo patrón que
 * `cart-button.tsx`.
 */
export function WishlistButton({
  slug,
  name,
  sku,
  pricePyg,
  size = "icon",
  className,
}: {
  slug: string;
  name: string;
  /** El SKU de la variante más barata, para el evento de medición. */
  sku?: string;
  pricePyg?: number;
  size?: "icon" | "inline";
  className?: string;
}) {
  const saved = useSyncExternalStore(
    wishlistSubscribe,
    () => wishlistHas(slug),
    () => false
  );

  const label = saved ? t("favoritos.quitar") : t("favoritos.guardar");

  function handleClick(event: React.MouseEvent) {
    // El botón "icon" vive adentro del <Link> de la tarjeta.
    event.preventDefault();
    event.stopPropagation();

    const nowSaved = wishlistToggle(slug);
    if (nowSaved) {
      // Sólo al guardar (no al sacar), igual que `add_to_cart` sólo se manda
      // al agregar. Sin SKU (no debería pasar: todo producto publicado tiene
      // al menos una variante) no se manda nada inventado.
      if (sku) {
        sendFunnelEvent("add_to_wishlist", [
          { id: sku, name, pricePyg: pricePyg ?? 0, qty: 1 },
        ]);
      }
      toast.success(t("favoritos.agregado"), { description: name });
    } else {
      toast(t("favoritos.quitado"), { description: name });
    }
  }

  if (size === "inline") {
    return (
      <Button
        type="button"
        variant="outline"
        size="lg"
        aria-pressed={saved}
        aria-label={label}
        data-testid={TESTIDS.wishlistButton}
        onClick={handleClick}
        className={className}
      >
        <Heart className={cn("size-4", saved && "fill-current")} />
        {label}
      </Button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={label}
      data-testid={TESTIDS.wishlistButton}
      onClick={handleClick}
      className={cn(
        "bg-background/80 text-foreground hover:bg-background absolute top-2 right-2 z-10 flex size-8 items-center justify-center rounded-full shadow-sm backdrop-blur transition-colors",
        className
      )}
    >
      <Heart className={cn("size-4", saved && "fill-current text-red-500")} />
    </button>
  );
}
