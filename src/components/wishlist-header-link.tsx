"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n/client";
import { TESTIDS } from "@/lib/testids";
import { useWishlist, wishlistCount } from "@/lib/wishlist-store";

/**
 * El link "Favoritos" del header, con contador — mismo patrón que
 * `cart-button.tsx`: `useSyncExternalStore` porque la lista vive en
 * `localStorage` y no existe en el servidor, así que el snapshot del
 * servidor (0) evita el flash y el hydration mismatch.
 */
export function WishlistHeaderLink() {
  const count = useSyncExternalStore(
    useWishlist.subscribe,
    () => wishlistCount(useWishlist.getState().slugs),
    () => 0
  );

  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className="relative"
      aria-label={
        count > 0 ? t("favoritos.abrirCon", { n: count }) : t("favoritos.abrir")
      }
    >
      <Link href="/favoritos" data-testid={TESTIDS.headerWishlistLink}>
        <Heart className="size-4" />
        <span className="hidden sm:inline">{t("favoritos.abrir")}</span>
        {count > 0 ? (
          <span className="bg-foreground text-background absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full text-[11px] font-medium tabular-nums">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
