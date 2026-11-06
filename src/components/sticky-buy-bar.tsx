"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n/client";

/**
 * Barra de compra fija abajo en el celular (`/admin/ajustes` → vidriera).
 *
 * En una ficha larga —fotos, descripción, reseñas— el botón de agregar queda
 * muy arriba, y quien bajó a leer tiene que volver a buscarlo. Esta barra
 * aparece **sólo** cuando ese bloque salió de la pantalla
 * (`IntersectionObserver`), y su botón no compra nada: lleva de vuelta al
 * bloque y le pone el foco. Elegir la variante y agregar al carrito siguen
 * pasando en un solo lugar (`add-to-cart.tsx`); duplicar esa lógica acá sería
 * tener dos carritos que se pueden desincronizar.
 *
 * Mientras está a la vista marca `<body data-barra-compra>`: `globals.css`
 * sube el botón flotante de WhatsApp para que la barra no lo tape.
 *
 * `md:hidden`: en pantallas grandes el bloque de compra está siempre cerca.
 */
export function StickyBuyBar({
  targetId,
  name,
  price,
  inquiry,
}: {
  /** El `id` del bloque de agregar al carrito de la ficha. */
  targetId: string;
  name: string;
  /** Ya formateado (`₲ 185.000`) por el servidor. */
  price: string | null;
  inquiry?: { href: string; variantLabel?: string; onClick: () => void };
}) {
  const [visible, setVisible] = useState(false);
  const isInquiry = inquiry !== undefined;

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) {
          setVisible(isInquiry ? entry.intersectionRatio < 0.99 : !entry.isIntersecting);
        }
      },
      { threshold: isInquiry ? 0.99 : 0 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetId, isInquiry]);

  useEffect(() => {
    if (!visible || isInquiry) return;
    document.body.setAttribute("data-barra-compra", "");
    return () => document.body.removeAttribute("data-barra-compra");
  }, [visible, isInquiry]);

  if (!visible) return null;

  const irAlBloque = (): void => {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const foco = target.querySelector<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])"
    );
    foco?.focus({ preventScroll: true });
  };

  return (
    <div
      role="region"
      aria-label={t(inquiry ? "producto.consultarWhatsApp" : "producto.barraCompra.label")}
      data-sticky-product-inquiry={inquiry ? "" : undefined}
      className="border-border bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 backdrop-blur md:hidden"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          {inquiry?.variantLabel || price ? (
            <p className="text-muted-foreground truncate text-xs tabular-nums">
              {inquiry?.variantLabel ?? price}
            </p>
          ) : null}
        </div>
        {inquiry ? (
          <Button asChild className="min-h-11">
            <a
              href={inquiry.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={inquiry.onClick}
            >
              {t("producto.consultarWhatsApp")}
            </a>
          </Button>
        ) : (
          <Button type="button" onClick={irAlBloque}>
            {t("producto.barraCompra.boton")}
          </Button>
        )}
      </div>
    </div>
  );
}
