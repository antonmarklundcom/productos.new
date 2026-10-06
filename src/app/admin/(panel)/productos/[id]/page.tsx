import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DuplicateProductButton } from "@/components/admin/bulk-actions";
import { ProductForm } from "@/components/admin/product-form";
import { ProductImages } from "@/components/admin/product-images";
import { VariantEditor } from "@/components/admin/variant-editor";
import {
  getAdminProduct,
  listCategories,
  listStockAdjustments,
} from "@/domain/admin-products";
import { formatDateTimePY } from "@/lib/py";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("panel.producto.meta") };

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function AdminProductPage({ params }: { params: Params }) {
  await requireCapabilityPage("productos");

  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) notFound();

  const found = await getAdminProduct(productId);
  if (!found) notFound();

  const { product, variants, images } = found;
  const categories = await listCategories();

  // Historial de ajustes de todas las variantes, en una sola lista.
  const adjustments = (
    await Promise.all(
      variants.map(async (variant) => {
        const rows = await listStockAdjustments(variant.id, 5);
        return rows.map((row) => ({
          ...row,
          variantLabel: variant.label,
          sku: variant.sku,
        }));
      })
    )
  )
    .flat()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 15);

  return (
    <div>
      <Link href="/admin/productos" className="text-muted-foreground text-sm">
        {t("panel.producto.volver")}
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{product.name}</h1>
        {/* Duplicar (O7 §5.3 C): staff, la misma capacidad de ABM que ya
            gobierna el resto de esta ficha. */}
        <DuplicateProductButton productId={product.id} />
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        <Link href={`/producto/${product.slug}`} className="underline">
          /producto/{product.slug}
        </Link>
      </p>

      <section className="mt-6">
        <h2 className="font-medium">{t("panel.producto.datos")}</h2>
        <div className="mt-2">
          <ProductForm
            categories={categories.map((category) => ({
              id: category.id,
              name: category.name,
            }))}
            defaults={{
              productId: product.id,
              saleMode: product.saleMode,
              showPrice: product.showPrice,
              slug: product.slug,
              name: product.name,
              description: product.description ?? "",
              categoryId: product.categoryId,
              brand: product.brand ?? "",
              ivaRate: product.ivaRate,
              isActive: product.isActive,
              published: product.publishedAt !== null,
              isFeatured: product.isFeatured,
            }}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-medium">{t("panel.producto.variantes")}</h2>
        <div className="mt-2">
          <VariantEditor
            productId={product.id}
            variants={variants.map((variant) => ({
              id: variant.id,
              sku: variant.sku,
              label: variant.label,
              pricePyg: variant.pricePyg,
              compareAtPyg: variant.compareAtPyg,
              isActive: variant.isActive,
              onHand: variant.onHand,
              heldQty: variant.heldQty,
              available: variant.available,
              reorderPoint: variant.reorderPoint,
            }))}
          />
        </div>
      </section>

      {adjustments.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-medium">{t("panel.producto.ultimosAjustes")}</h2>
          <ul className="divide-border mt-2 divide-y text-sm">
            {adjustments.map((adjustment) => (
              <li key={adjustment.id} className="py-2">
                <div className="flex justify-between gap-3">
                  <span>
                    {adjustment.variantLabel}
                    <span className="text-muted-foreground">
                      {" "}
                      · {adjustment.sku}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {adjustment.delta > 0 ? "+" : ""}
                    {adjustment.delta}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("panel.producto.ajusteLinea", {
                    fecha: formatDateTimePY(adjustment.createdAt),
                    actor: adjustment.actor,
                    antes: adjustment.previousOnHand,
                    despues: adjustment.newOnHand,
                    motivo: adjustment.reason,
                  })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="font-medium">{t("panel.producto.fotos")}</h2>
        <div className="mt-2">
          <ProductImages
            productId={product.id}
            images={images.map((image) => ({
              id: image.id,
              cloudinaryId: image.cloudinaryId,
              alt: image.alt,
            }))}
          />
        </div>
      </section>
    </div>
  );
}
