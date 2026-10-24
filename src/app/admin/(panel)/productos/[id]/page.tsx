import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DuplicateProductButton } from "@/components/admin/bulk-actions";
import { ProductRevisionProvider } from "@/components/admin/product-revision";
import { ProductForm } from "@/components/admin/product-form";
import { ProductImages } from "@/components/admin/product-images";
import { VariantEditor } from "@/components/admin/variant-editor";
import { SupplierCostEditor } from "@/components/admin/supplier-cost-editor";
import {
  getAdminProduct,
  listCategories,
  listStockAdjustments,
} from "@/domain/admin-products";
import { formatDateTimePY } from "@/lib/py";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { t } from "@/i18n";
import { requireStaffSession } from "@/lib/admin-guard";
import { getDb } from "@/db";
import { catalogAudit } from "@/db/schema";
import { and,eq,desc } from "drizzle-orm";

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
  const actor=await requireStaffSession();
  const history=await getDb().select().from(catalogAudit).where(and(eq(catalogAudit.recordType,"product"),eq(catalogAudit.recordId,productId),actor.role==="owner"?undefined:eq(catalogAudit.actorId,actor.userId))).orderBy(desc(catalogAudit.createdAt),desc(catalogAudit.id)).limit(20);
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
    <ProductRevisionProvider revision={product.revision}>
    <div>
      <Link href="/admin/productos" className="text-muted-foreground text-sm">
        {t("panel.producto.volver")}
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{product.name}</h1>
        {/* Duplicar (O7 §5.3 C): staff, la misma capacidad de ABM que ya
            gobierna el resto de esta ficha. */}
        <DuplicateProductButton productId={product.id} expectedRevision={product.revision} />
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
              revision: product.revision,
              saleMode: product.saleMode,
              showPrice: product.showPrice,
              slug: product.slug,
              name: product.name,
              description: product.description ?? "",
              categoryId: product.categoryId,
              brand: product.brand ?? "",
              dropiUrl: product.dropiUrl ?? "",
              ivaRate: product.ivaRate,
              isActive: product.isActive,
              published: product.publishedAt !== null,
              isFeatured: product.isFeatured,
              featuredPosition:product.featuredPosition,
            }}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-medium">{t("panel.producto.variantes")}</h2>
        <div className="mt-2">
          <VariantEditor
            productId={product.id}
            revision={product.revision}
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

      <section className="mt-8">
        <h2 className="font-medium">{t("panel.costos.titulo")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("panel.costos.ayuda")}
        </p>
        {!found.costsReady ? (
          <p role="status" className="mt-2 text-sm">
            {t("panel.costos.migracion")}
          </p>
        ) : null}
        {variants.map((variant) => (
          <SupplierCostEditor
            key={variant.id}
            productId={product.id}
            variant={variant}
            ready={found.costsReady}
          />
        ))}
      </section>

      <section className="mt-8" aria-label="Historial del catálogo">
        <h2 className="font-medium">Historial del catálogo</h2>
        <p className="text-muted-foreground text-xs">Últimos 20 eventos {actor.role==="owner"?"del producto":"de tu usuario"}. Sólo se guardan campos afectados y versiones.</p>
        <ul className="mt-2 text-sm">{history.map(event=><li key={event.id}>{formatDateTimePY(event.createdAt)} · Usuario {event.actorId} · {event.operation} · versión {event.revision} · {event.fields}</li>)}</ul>
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
    </ProductRevisionProvider>
  );
}
