"use client";

import { useSyncExternalStore } from "react";
import { ShoppingBag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n/client";
import { cartCount, useCart } from "@/lib/cart-store";
import { TESTIDS } from "@/lib/testids";

export function CartButton() {
  const open = useCart((state) => state.open);

  // El carrito vive en localStorage y no existe durante el render del
  // servidor. `useSyncExternalStore` con snapshot de servidor = 0 es
  // justamente para esto: sin flash y sin hydration mismatch.
  const count = useSyncExternalStore(
    useCart.subscribe,
    () => cartCount(useCart.getState().lines),
    () => 0
  );

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={open}
      data-testid={TESTIDS.headerCartLink}
      className="relative"
      aria-label={
        count > 0 ? t("carrito.abrirCon", { n: count }) : t("carrito.abrir")
      }
    >
      <ShoppingBag className="size-4" />
      <span className="hidden sm:inline">{t("carrito.boton")}</span>
      {count > 0 ? (
        <span className="bg-foreground text-background absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full text-[11px] font-medium tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Button>
  );
}
