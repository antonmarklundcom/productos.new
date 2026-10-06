import type { Metadata } from "next";
import Link from "next/link";

import { ProductForm } from "@/components/admin/product-form";
import { listCategories } from "@/domain/admin-products";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("panel.productoNuevo.meta") };

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  await requireCapabilityPage("productos");

  const categories = await listCategories();

  return (
    <div>
      <Link href="/admin/productos" className="text-muted-foreground text-sm">
        {t("panel.productoNuevo.volver")}
      </Link>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">{t("panel.productoNuevo.titulo")}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {t("panel.productoNuevo.bajada")}
      </p>

      <div className="mt-6">
        <ProductForm
          categories={categories.map((category) => ({ id: category.id, name: category.name }))}
          defaults={{
            slug: "",
            name: "",
            description: "",
            categoryId: categories[0]?.id ?? 0,
            brand: "",
            ivaRate: 10,
            isActive: true,
            published: false,
            isFeatured: false,
          }}
        />
      </div>
    </div>
  );
}
