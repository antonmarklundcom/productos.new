"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { QuantityStepper } from "@/components/quantity-stepper";
import { StockAlertForm } from "@/components/stock-alert-form";
import { StockBadge } from "@/components/stock-badge";
import { PriceTag } from "@/components/price-tag";
import { Button } from "@/components/ui/button";
import { VariantInquiryLink } from "@/components/variant-inquiry-link";
import { useCart } from "@/lib/cart-store";
import { sendFunnelEvent } from "@/lib/funnel";
import { recallVariant, rememberVariant } from "@/lib/variant-memory";
import { TESTIDS } from "@/lib/testids";
import { cn } from "@/lib/utils";
import type { CatalogProductDetail } from "@/db/queries";
import { t } from "@/i18n/client";

/**
 * Selector de variante + agregar al carrito.
 *
 * La disponibilidad que llega acá viene del server render; el chequeo que
 * manda es el del servidor (revalidación del carrito y, después, la reserva
 * en el checkout). Acá sólo evitamos que el comprador pida algo que ya
 * sabemos que no está.
 *
 * `stockAlertsEnabled` y `whatsappPhone` los decide la page (server): la
 * primera es `stockAlertsEnabled()` del dominio, y sin sender configurado
 * llega en `false` — nunca se dibuja un botón que no puede funcionar. La
 * segunda es `WHATSAPP_NUMBER` ya normalizado; sin ella no hay link de
 * consulta por variante.
 */
export function AddToCart({
  product,
  stockAlertsEnabled = false,
  whatsappPhone = null,
  productUrl = null,
  inquiryLinks = {},
}: {
  product: CatalogProductDetail;
  stockAlertsEnabled?: boolean;
  whatsappPhone?: string | null;
  productUrl?: string | null;
  inquiryLinks?: Record<number, string>;
}) {
  const purchasable =
    (product.saleMode ?? "stock") === "stock" && product.showPrice !== false;
  const add = useCart((state) => state.add);
  const firstAvailable = product.variants.find(
    (variant) => variant.available > 0
  );
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const [qty, setQty] = useState(1);

  /**
   * La variante que venía eligiendo, si la hay.
   *
   * Va por `useSyncExternalStore` y no por un efecto: localStorage no existe
   * en el servidor, así que el snapshot del servidor es `null` y React aplica
   * el del navegador después de hidratar, sin desajuste ni render en cascada.
   * `subscribe` no hace nada porque el dato no cambia solo mientras la página
   * está abierta.
   */
  const rememberedId = useSyncExternalStore(
    () => () => {},
    () => recallVariant(product.slug),
    () => null
  );
  // Sólo vale si esa variante sigue existiendo y con stock: es un atajo, no
  // una decisión. Todo lo que se cobra lo recalcula el servidor.
  const remembered = product.variants.find(
    (variant) =>
      variant.id === rememberedId && (!purchasable || variant.available > 0)
  );

  const variantId =
    picked ?? remembered?.id ?? firstAvailable?.id ?? product.variants[0]?.id;
  const selected = product.variants.find((variant) => variant.id === variantId);
  const max = Math.max(1, Math.min(99, selected?.available ?? 0));
  const canAdd = Boolean(purchasable && selected && selected.available > 0);

  return (
    <div className="space-y-4">
      {product.variants.length > 1 ? (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            {t("producto.elegiOpcion")}
          </legend>
          <div className="flex flex-wrap gap-2">
            {product.variants.map((variant) => {
              const disabled = purchasable && variant.available <= 0;
              return (
                <button
                  key={variant.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setPicked(variant.id);
                    setQty(1);
                    rememberVariant(product.slug, variant.id);
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm transition-colors",
                    variant.id === variantId
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:border-foreground/40",
                    disabled &&
                      "text-muted-foreground cursor-not-allowed line-through opacity-60"
                  )}
                >
                  {variant.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {selected ? (
        <div className="flex flex-wrap items-center gap-3">
          {product.showPrice !== false ? (
            <PriceTag
              pricePyg={selected.pricePyg}
              compareAtPyg={selected.compareAtPyg}
              size="lg"
              showIvaNote={purchasable}
            />
          ) : null}
          {purchasable ? (
            <StockBadge available={selected.available} />
          ) : (
            <span className="text-sm">
              {t(
                product.saleMode === "enquiry"
                  ? "producto.soloConsulta"
                  : "producto.muestra"
              )}
            </span>
          )}
          {!purchasable && product.showPrice !== false ? (
            <p className="text-sm">{t("producto.precioOrientativo")}</p>
          ) : null}
        </div>
      ) : null}

      {purchasable ? (
        <div className="flex flex-wrap items-center gap-3">
          <QuantityStepper value={qty} onChange={setQty} max={max} />
          <Button
            size="lg"
            disabled={!canAdd}
            data-testid={TESTIDS.productAddToCart}
            onClick={() => {
              if (!selected) return;
              rememberVariant(product.slug, selected.id);
              add(
                {
                  variantId: selected.id,
                  productSlug: product.slug,
                  name: product.name,
                  variantLabel: selected.label,
                  unitPricePyg: selected.pricePyg,
                  sku: selected.sku,
                },
                qty
              );
              // Para GA4 / Meta (src/lib/funnel.ts). Sin medidores no hace nada.
              sendFunnelEvent("add_to_cart", [
                {
                  id: selected.sku,
                  name: product.name,
                  pricePyg: selected.pricePyg,
                  qty,
                },
              ]);
              toast.success(t("producto.agregado"), {
                description: `${product.name} — ${selected.label}`,
              });
            }}
          >
            {canAdd ? t("producto.agregar") : t("stock.sin")}
          </Button>
          {selected ? (
            <VariantInquiryLink
              phone={whatsappPhone}
              productName={product.name}
              variantLabel={selected.label}
              sku={selected.sku}
              productUrl={productUrl}
            />
          ) : null}
        </div>
      ) : selected &&
        product.saleMode === "enquiry" &&
        inquiryLinks[selected.id] ? (
        <a
          href={inquiryLinks[selected.id]}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={TESTIDS.variantInquiryLink}
          className="inline-flex rounded-lg border px-4 py-3"
        >
          {t("producto.consultarWhatsApp")}
        </a>
      ) : null}

      {/* Sólo cuando la variante elegida no tiene disponibilidad y la page
          confirmó que hay con qué avisar — nunca un formulario que no puede
          funcionar (plan-operacion §6.3). */}
      {purchasable && selected && !canAdd && stockAlertsEnabled ? (
        <StockAlertForm variantId={selected.id} />
      ) : null}
    </div>
  );
}
