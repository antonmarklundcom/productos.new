import type { Metadata } from "next";

import { CategoriesManager } from "@/components/admin/categories-manager";
import { listAdminCategories } from "@/domain/admin-categories";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("panel.categorias.meta") };

export const dynamic = "force-dynamic";

/**
 * `/admin/categorias` — owner-only (PLAN.md FASE 2, PR J).
 *
 * Hasta este PR esta tabla la escribía sólo `scripts/seed.ts`: agregar una
 * categoría era una tarea de desarrollador con acceso a la base. Ahora es un
 * formulario.
 */
export default async function AdminCategoriesPage() {
  await requireCapabilityPage("categorias");
  const categories = await listAdminCategories();

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{t("panel.categorias.titulo")}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {t("panel.categorias.bajada")}
      </p>

      <div className="mt-6">
        <CategoriesManager
          categories={categories.map((category, index) => ({
            id: category.id,
            slug: category.slug,
            name: category.name,
            isActive: category.isActive,
            productos: category.productos,
            publicados: category.publicados,
            esPrimera: index === 0,
            esUltima: index === categories.length - 1,
            description: category.description,
            imageCloudinaryId: category.imageCloudinaryId,
            imageAlt: category.imageAlt,
          }))}
        />
      </div>
    </div>
  );
}
