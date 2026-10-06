"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CART_STORAGE_KEY } from "@/lib/cart-store";
import { t } from "@/i18n/client";
import { categoryPlaceholderSrc, productImageUrl } from "@/lib/images";
import { formatGs } from "@/lib/money";
import { TESTIDS } from "@/lib/testids";

/**
 * Vistos recientemente (plan-operacion §6.3), sólo cliente.
 *
 * No hay endpoint nuevo para esto (límite §4.7 del plan): se guarda en
 * `localStorage` el mínimo para dibujar una ficha —slug, nombre, precio,
 * imagen— al visitar cada producto, y se dibuja de ahí. Si el precio cambió
 * desde la última visita, se ve el viejo hasta que la compradora vuelva a
 * entrar a esa ficha: aceptable, y es la única alternativa sin inventar un
 * endpoint que el plan no pidió.
 *
 * Renderiza recién después de `useEffect` (arranca en `null`) para que el
 * primer render del servidor y el primero del cliente sean idénticos — nada
 * de esto existe en el servidor, así que cualquier intento de dibujarlo antes
 * de hidratar sería un desajuste. Con `localStorage` bloqueado (o
 * inexistente), el `try/catch` deja la lista vacía y el componente no dibuja
 * nada, sin ningún error en consola (lo verifica `csp.spec.ts`).
 */

export type RecentlyViewedItem = {
  slug: string;
  name: string;
  pricePyg: number;
  imageCloudinaryId: string | null;
  imageAlt: string | null;
};

const STORAGE_KEY = `${CART_STORAGE_KEY}-vistos`;
const MAX_ITEMS = 8;

function isItem(value: unknown): value is RecentlyViewedItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RecentlyViewedItem>;
  return (
    typeof item.slug === "string" &&
    item.slug !== "" &&
    typeof item.name === "string" &&
    Number.isInteger(item.pricePyg) &&
    (item.imageCloudinaryId === null ||
      typeof item.imageCloudinaryId === "string") &&
    (item.imageAlt === null || typeof item.imageAlt === "string")
  );
}

function readList(): RecentlyViewedItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch {
    return [];
  }
}

function writeList(items: RecentlyViewedItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage bloqueado (modo privado, cookies de terceros apagadas):
    // no se guarda nada, y no es un error — es sólo que esta compradora no
    // tiene "vistos recientemente" hoy.
  }
}

export function RecentlyViewed({ current }: { current: RecentlyViewedItem }) {
  const [items, setItems] = useState<RecentlyViewedItem[] | null>(null);

  useEffect(() => {
    // El `setState` va adentro del `setTimeout` y no suelto en el cuerpo del
    // efecto: un `setState` síncrono ahí dispara un render en cascada y la
    // regla `set-state-in-effect` de React lo marca (mismo patrón que
    // `search-box.tsx`). El timeout de 0 alcanza — no hay nada que esperar,
    // sólo que el `setState` quede en un callback en vez de en el cuerpo.
    const timer = setTimeout(() => {
      const existing = readList();
      const next = [
        current,
        ...existing.filter((item) => item.slug !== current.slug),
      ].slice(0, MAX_ITEMS);
      writeList(next);
      setItems(next.filter((item) => item.slug !== current.slug));
    }, 0);

    return () => clearTimeout(timer);
    // Se re-corre por slug, no por identidad de `current`: la page arma un
    // objeto nuevo en cada render y no queremos re-escribir localStorage sin
    // que cambie nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                <p className="text-muted-foreground mt-auto pt-2 text-sm tabular-nums">
                  {formatGs(item.pricePyg)}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
