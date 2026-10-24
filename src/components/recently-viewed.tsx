"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CART_STORAGE_KEY } from "@/lib/cart-store";
import { t } from "@/i18n/client";
import { categoryPlaceholderSrc, productImageUrl } from "@/lib/images";
import { formatGs } from "@/lib/money";
import { TESTIDS } from "@/lib/testids";

export type RecentlyViewedId = { slug: string; viewedAt: number };
export type PublicRecentlyViewedProduct = {
  slug: string;
  name: string;
  pricePyg: number | null;
  imageCloudinaryId: string | null;
  imageAlt: string | null;
};

const STORAGE_KEY = `${CART_STORAGE_KEY}-vistos`;
const MAX_ITEMS = 8;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isId(value: unknown, now: number): value is RecentlyViewedId {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RecentlyViewedId>;
  return (
    typeof item.slug === "string" &&
    SAFE_SLUG.test(item.slug) &&
    Number.isSafeInteger(item.viewedAt) &&
    (item.viewedAt as number) <= now &&
    now - (item.viewedAt as number) <= TTL_MS
  );
}

function readList(now: number): RecentlyViewedId[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.flatMap((value): RecentlyViewedId[] => {
      // Migrate the old snapshot format by carrying forward only its slug; its
      // cached price/name/image are deliberately discarded and re-fetched.
      const legacy = value && typeof value === "object" ? value as { slug?: unknown; viewedAt?: unknown } : null;
      const item = isId(value, now)
        ? value
        : legacy && typeof legacy.slug === "string" && SAFE_SLUG.test(legacy.slug) && legacy.viewedAt === undefined
          ? { slug: legacy.slug, viewedAt: now }
          : null;
      if (!item || seen.has(item.slug)) return [];
      seen.add(item.slug);
      return [item];
    }).slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function writeList(items: RecentlyViewedId[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // El historial es opcional; si el navegador bloquea el almacenamiento no se muestra.
  }
}

function isPublicProduct(value: unknown): value is PublicRecentlyViewedProduct {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PublicRecentlyViewedProduct>;
  return (
    typeof item.slug === "string" && SAFE_SLUG.test(item.slug) &&
    typeof item.name === "string" && item.name.length > 0 && item.name.length <= 240 &&
    (item.pricePyg === null || (Number.isSafeInteger(item.pricePyg) && (item.pricePyg as number) > 0)) &&
    (item.imageCloudinaryId === null || typeof item.imageCloudinaryId === "string") &&
    (item.imageAlt === null || typeof item.imageAlt === "string")
  );
}

export function RecentlyViewed({ current }: { current: { slug: string } }) {
  const [items, setItems] = useState<PublicRecentlyViewedProduct[] | null>(null);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        const now = Date.now();
        const existing = readList(now).filter((item) => item.slug !== current.slug);
        const history = [
          ...(SAFE_SLUG.test(current.slug) ? [{ slug: current.slug, viewedAt: now }] : []),
          ...existing,
        ].slice(0, MAX_ITEMS);
        writeList(history);
        const slugs = history.map((item) => item.slug);
        if (slugs.length === 0) {
          if (active) setItems([]);
          return;
        }
        try {
          const query = new URLSearchParams({ slugs: slugs.join(",") });
          const response = await fetch(`/api/catalog/recently-viewed?${query}`, {
            cache: "no-store",
            headers: { Accept: "application/json" },
          });
          if (!response.ok) throw new Error("No se pudo actualizar el catálogo.");
          const payload: unknown = await response.json();
          const products =
            payload && typeof payload === "object" && Array.isArray((payload as { products?: unknown }).products)
              ? (payload as { products: unknown[] }).products.filter(isPublicProduct)
              : [];
          if (active) setItems(products.filter((item) => item.slug !== current.slug).slice(0, MAX_ITEMS - 1));
        } catch {
          // Sin conexión no usamos precios ni publicación guardados en el navegador.
          if (active) setItems([]);
        }
      })();
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [current.slug]);

  if (!items || items.length === 0) return null;

  return (
    <section className="border-border mt-12 border-t pt-8">
      <h2 className="text-lg font-semibold tracking-tight">
        {t("producto.vistosRecientemente")}
      </h2>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {items.map((item) => {
          const url = productImageUrl(item.imageCloudinaryId, "card");
          return (
            <Link
              key={item.slug}
              href={`/producto/${item.slug}`}
              data-testid={TESTIDS.recentlyViewedItem}
              data-slug={item.slug}
              className="group border-border hover:border-foreground/20 focus-visible:ring-ring flex flex-col rounded-xl border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <div className="bg-muted relative aspect-square overflow-hidden rounded-lg">
                <Image
                  src={url ?? categoryPlaceholderSrc("generico")}
                  alt={item.imageAlt ?? item.name}
                  fill
                  unoptimized={Boolean(url)}
                  sizes="(max-width: 640px) 50vw, 300px"
                  className="object-cover"
                />
              </div>
              <div className="mt-3 flex flex-1 flex-col gap-1">
                <h3 className="group-hover:text-foreground line-clamp-2 text-sm font-medium">
                  {item.name}
                </h3>
                {item.pricePyg !== null ? (
                  <p className="text-muted-foreground mt-auto pt-2 text-sm tabular-nums">
                    {formatGs(item.pricePyg)}
                  </p>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
