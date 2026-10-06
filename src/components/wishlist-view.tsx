"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { getWishlistProducts } from "@/app/actions/wishlist";
import { ProductCard, ProductCardSkeleton } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import type { CatalogProduct } from "@/db/queries";
import { t } from "@/i18n/client";
import { waShareLink } from "@/lib/py";
import { siteOrigin } from "@/lib/site-url";
import { TESTIDS } from "@/lib/testids";
import { useWishlist } from "@/lib/wishlist-store";

const MAX_SHARED_SLUGS = 50;

function parseSharedSlugs(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean)
    .slice(0, MAX_SHARED_SLUGS);
}

/**
 * `/favoritos`, en dos modos:
 *
 * - **La propia lista** (sin `?p=`): los slugs salen de `wishlist-store.ts`
 *   (localStorage) y se resuelven contra la DB para dibujarse — el store
 *   nunca guarda precio ni nombre (ver ese archivo).
 * - **Una lista compartida** (`?p=slug1,slug2`): los slugs salen de la URL,
 *   no del navegador de quien la abre. Nunca se auto-guardan en la lista de
 *   quien mira: el botón "Guardar todos" es una acción explícita.
 *
 * Siempre server-resuelto: lo que se ve —precio, disponibilidad, si sigue
 * publicado— es lo que dice hoy la DB, nunca lo que había cuando se guardó.
 */
export function WishlistView() {
  const searchParams = useSearchParams();
  const sharedSlugs = useMemo(
    () => parseSharedSlugs(searchParams.get("p")),
    [searchParams]
  );
  const isShared = sharedSlugs.length > 0;

  const mySlugs = useWishlist((state) => state.slugs);
  const addMany = useWishlist((state) => state.addMany);
  const slugs = isShared ? sharedSlugs : mySlugs;
  const slugsKey = slugs.join(",");

  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // El `setState` va adentro del `setTimeout`, no suelto en el cuerpo del
    // efecto: mismo motivo que `recently-viewed.tsx` — un `setState` síncrono
    // ahí dispara un render en cascada y la regla `set-state-in-effect` de
    // React lo marca. El timeout de 0 alcanza, no hay nada que esperar.
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      if (slugs.length === 0) {
        setProducts([]);
        return;
      }
      setProducts(null);
      void getWishlistProducts(slugs).then((result) => {
        if (!cancelled) setProducts(result);
      });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Se re-corre por el contenido de la lista, no por su identidad: cada
    // render de `useWishlist` arma un array nuevo aunque los slugs sean los
    // mismos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugsKey]);

  const origin = siteOrigin();
  const shareUrl = origin
    ? new URL(`/favoritos?p=${slugsKey}`, origin).toString()
    : null;
  const waShareHref = shareUrl
    ? waShareLink(`${t("favoritos.compartirWhatsApp.texto")} ${shareUrl}`)
    : null;

  function handleGuardarTodos() {
    addMany(sharedSlugs);
    setSaved(true);
    toast.success(t("favoritos.agregado"));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isShared ? t("favoritos.tituloCompartido") : t("favoritos.titulo")}
        </h1>

        <div className="flex flex-wrap gap-2">
          {isShared && products && products.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saved}
              data-testid={TESTIDS.wishlistSaveAll}
              onClick={handleGuardarTodos}
            >
              {t("favoritos.guardarTodos")}
            </Button>
          ) : null}

          {!isShared && waShareHref && products && products.length > 0 ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              data-testid={TESTIDS.wishlistShareWhatsapp}
            >
              <a href={waShareHref} target="_blank" rel="noopener noreferrer">
                {t("favoritos.compartirWhatsApp")}
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {products === null ? (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: slugs.length || 4 }).map((_, index) => (
            <ProductCardSkeleton key={index} />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="border-border mt-8 rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">{t("favoritos.vacio")}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("favoritos.vacio.ayuda")}
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/">{t("favoritos.vacio.irAlInicio")}</Link>
          </Button>
        </div>
      ) : (
        <div
          className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4"
          data-testid={TESTIDS.wishlistGrid}
        >
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
