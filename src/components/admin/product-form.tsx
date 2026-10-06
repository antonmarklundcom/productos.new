"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveProduct } from "@/app/actions/admin-products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/admin/markdown-editor";
import { slugify } from "@/lib/slug";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

export type ProductFormValues = {
  saleMode?: "stock" | "enquiry" | "showcase";
  showPrice?: boolean;
  productId?: number;
  slug: string;
  name: string;
  description: string;
  categoryId: number;
  brand: string;
  ivaRate: number;
  isActive: boolean;
  published: boolean;
  // == S17 == Destacado en la home (O14 dejó `isFeatured` en `saveProduct`).
  isFeatured: boolean;
};

export function ProductForm({
  defaults,
  categories,
}: {
  defaults: ProductFormValues;
  categories: Array<{ id: number; name: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState(defaults.slug);
  // Sólo se autocompleta el slug de un producto nuevo: cambiarlo en uno ya
  // publicado le rompe la URL y el SEO.
  const [slugTouched, setSlugTouched] = useState(
    defaults.productId !== undefined
  );

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);

        startTransition(async () => {
          const result = await saveProduct({
            productId: defaults.productId,
            saleMode: String(data.get("saleMode") ?? "stock"),
            showPrice: data.get("showPrice") === "on",
            slug: String(data.get("slug") ?? ""),
            name: String(data.get("name") ?? ""),
            description: String(data.get("description") ?? ""),
            categoryId: Number(data.get("categoryId")),
            brand: String(data.get("brand") ?? ""),
            ivaRate: Number(data.get("ivaRate")),
            isActive: data.get("isActive") === "on",
            published: data.get("published") === "on",
            isFeatured: data.get("isFeatured") === "on",
          });

          if (!result.ok) {
            setError(result.error);
            return;
          }

          toast.success(t("panel.producto.guardado"));
          if (defaults.productId === undefined) {
            router.push(`/admin/productos/${result.productId}`);
            return;
          }
          router.refresh();
        });
      }}
    >
      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor="name">{t("panel.producto.nombre")}</Label>
        <Input
          id="name"
          name="name"
          required
          data-testid={TESTIDS.adminProductNameInput}
          defaultValue={defaults.name}
          onChange={(event) => {
            if (!slugTouched) setSlug(slugify(event.target.value));
          }}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="slug">{t("panel.producto.slug")}</Label>
        <Input
          id="slug"
          name="slug"
          required
          value={slug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.target.value);
          }}
        />
      </div>

      {/* Markdown seguro (O7 §5.3 D): el `<textarea name="description">` de
          adentro es exactamente el mismo campo que leía `saveProduct` antes
          de este PR, así que el submit no cambió — sólo se le sumó la
          pestaña de vista previa, renderizada en el cliente con la misma
          función que va a usar la ficha pública del producto. */}
      <div className="grid gap-2">
        <Label htmlFor="saleMode">{t("panel.producto.modo")}</Label>
        <select
          id="saleMode"
          name="saleMode"
          defaultValue={defaults.saleMode ?? "stock"}
          className="rounded border p-2"
        >
          <option value="stock">{t("panel.producto.modo.stock")}</option>
          <option value="enquiry">{t("panel.producto.modo.enquiry")}</option>
          <option value="showcase">{t("panel.producto.modo.showcase")}</option>
        </select>
        <label className="flex gap-2">
          <input
            type="checkbox"
            name="showPrice"
            defaultChecked={defaults.showPrice !== false}
          />
          {t("panel.producto.mostrarPrecio")}
        </label>
      </div>
      <MarkdownEditor
        name="description"
        label={t("panel.producto.descripcion")}
        defaultValue={defaults.description}
        rows={4}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="categoryId">{t("panel.producto.categoria")}</Label>
          <select
            id="categoryId"
            name="categoryId"
            required
            defaultValue={String(defaults.categoryId || "")}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="" disabled>
              {t("panel.producto.elegiCategoria")}
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="brand">{t("panel.producto.marca")}</Label>
          <Input id="brand" name="brand" defaultValue={defaults.brand} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ivaRate">{t("panel.producto.iva")}</Label>
          <select
            id="ivaRate"
            name="ivaRate"
            defaultValue={String(defaults.ivaRate)}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="10">{t("panel.producto.iva10")}</option>
            <option value="5">{t("panel.producto.iva5")}</option>
            <option value="0">{t("panel.producto.iva0")}</option>
          </select>
        </div>
      </div>

      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={defaults.isActive}
          />
          {t("panel.producto.activo")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="published"
            defaultChecked={defaults.published}
          />
          {t("panel.producto.publicado")}
        </label>
        <p className="text-muted-foreground text-xs">
          {t("panel.producto.publicadoAyuda")}
        </p>

        {/* == S17 == `isFeatured` ya lo acepta `saveProduct` (O14); esto es
            sólo el checkbox que faltaba para prenderlo desde el panel. */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isFeatured"
            data-testid={TESTIDS.adminProductFeaturedToggle}
            defaultChecked={defaults.isFeatured}
          />
          {t("panel.producto.destacado")}
        </label>
        <p className="text-muted-foreground text-xs">
          {t("panel.producto.destacadoAyuda")}
        </p>
      </div>

      <Button
        type="submit"
        data-testid={TESTIDS.adminProductSaveSubmit}
        disabled={isPending}
      >
        {isPending
          ? t("panel.acciones.guardando")
          : t("panel.producto.guardar")}
      </Button>
    </form>
  );
}
