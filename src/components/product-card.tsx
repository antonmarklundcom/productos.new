import Link from "next/link";

import { PriceTag } from "@/components/price-tag";
import { ProductImage } from "@/components/product-image";
import { RatingStars, formatRating } from "@/components/rating-stars";
import { StockBadge } from "@/components/stock-badge";
import { WishlistButton } from "@/components/wishlist-button";
import type { CatalogProduct } from "@/db/queries";
import { t, tPlural } from "@/i18n/client";
import { TESTIDS } from "@/lib/testids";
import { formatGs } from "@/lib/money";
import { LOCAL_DEMO_PRICE_PYG } from "@/config/preview";

export function ProductCard({
  product,
  priority = false,
  showRating = false,
}: {
  product: CatalogProduct;
  priority?: boolean;
  /**
   * Estrellas en la tarjeta (`/admin/ajustes` → vidriera). Lo decide la
   * página, que es server: esta tarjeta también se dibuja en el cliente
   * (favoritos) y no puede leer los ajustes. Sin reseñas aprobadas no se
   * dibuja nada aunque esté prendido.
   */
  showRating?: boolean;
}) {
  // El precio "desde" es el de la variante más barata disponible; si no hay
  // ninguna con stock, igual mostramos el más barato para no dejar el card mudo.
  const inStock = product.variants.filter((variant) => variant.available > 0);
  const shown = (inStock.length > 0 ? inStock : product.variants).reduce<
    CatalogProduct["variants"][number] | undefined
  >(
    (cheapest, variant) =>
      !cheapest || variant.pricePyg < cheapest.pricePyg ? variant : cheapest,
    undefined
  );

  const totalAvailable = product.variants.reduce(
    (total, variant) => total + variant.available,
    0
  );
  const hasVariantRange = product.variants.length > 1;

  return (
    <Link
      href={`/producto/${product.slug}`}
      data-testid={TESTIDS.productCard}
      data-slug={product.slug}
      className="store-product-card group border-border hover:border-foreground/20 focus-visible:ring-ring flex flex-col rounded-2xl border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <div className="relative">
        <ProductImage
          image={product.image}
          alt={product.name}
          categorySlug={product.categorySlug}
          priority={priority}
        />
        <WishlistButton
          slug={product.slug}
          name={product.name}
          sku={shown?.sku}
          pricePyg={product.showPrice === false ? undefined : shown?.pricePyg}
        />
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-1">
        {product.image?.cloudinaryId.startsWith("local-preview:") ? (
          <span className="text-muted-foreground text-[10px] font-medium">
            Demostración · No está a la venta
          </span>
        ) : null}
        <p className="text-muted-foreground text-xs">
          {product.brand ?? product.categoryName}
        </p>
        <h3 className="group-hover:text-foreground line-clamp-2 text-sm font-medium">
          {product.name}
        </h3>
        {showRating && product.rating && product.rating.count >= 1 ? (
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <RatingStars value={product.rating.average} size={12} />
            <span aria-hidden>{formatRating(product.rating.average)}</span>
            <span>({tPlural("catalogo.resenas", product.rating.count)})</span>
          </p>
        ) : null}

        <div className="mt-auto pt-2">
          {product.image?.cloudinaryId === "local-preview:auriculares" &&
          shown ? (
            <p className="text-xs">
              <strong className="text-base">
                {formatGs(LOCAL_DEMO_PRICE_PYG)}
              </strong>
              <span className="text-muted-foreground block text-[10px]">
                Precio ilustrativo
              </span>
            </p>
          ) : null}
          {shown && product.showPrice !== false ? (
            <PriceTag
              pricePyg={shown.pricePyg}
              compareAtPyg={shown.compareAtPyg}
              size="sm"
            />
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            {(product.saleMode ?? "stock") === "stock" ? (
              <StockBadge available={totalAvailable} />
            ) : (
              <span className="text-xs">
                {t(
                  product.saleMode === "enquiry"
                    ? "producto.soloConsulta"
                    : "producto.muestra"
                )}
              </span>
            )}
            {hasVariantRange ? (
              <span className="text-muted-foreground text-xs">
                {t("catalogo.opciones", { n: product.variants.length })}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="border-border rounded-xl border p-3">
      <div className="bg-muted aspect-square animate-pulse rounded-lg" />
      <div className="mt-3 space-y-2">
        <div className="bg-muted h-3 w-1/3 animate-pulse rounded" />
        <div className="bg-muted h-4 w-4/5 animate-pulse rounded" />
        <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
      </div>
    </div>
  );
}
