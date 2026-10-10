import Link from "next/link";
import { sql } from "drizzle-orm";
import { requireCapabilityPage } from "../../src/lib/admin-guard";
import { can } from "../../src/lib/permissions";
import { getNativeDb } from "./database";

/** Native catalog dashboard: no unported order/shipping claims or queries. */
export default async function D1CatalogSummary() {
  const actor = await requireCapabilityPage("dashboard");
  const counts = await getNativeDb().get<{
    products: number;
    published: number;
    categories: number;
    images: number;
  }>(sql`
    SELECT (SELECT COUNT(*) FROM products) AS products,
      (SELECT COUNT(*) FROM products WHERE is_active = 1 AND published_at IS NOT NULL) AS published,
      (SELECT COUNT(*) FROM categories) AS categories,
      (SELECT COUNT(*) FROM product_images) AS images`);
  if (!counts) throw new Error("D1_CATALOG_SUMMARY_MISSING_RESULT");
  return (
    <section className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Resumen</h1>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Productos", counts.products],
          ["Publicados", counts.published],
          ["Categorías", counts.categories],
          ["Fotos de galería", counts.images],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border p-5">
            <dt className="text-muted-foreground text-sm">{label}</dt>
            <dd className="mt-2 text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p>
        Las consultas de productos se reciben por WhatsApp. El checkout, los
        pagos y las reservas de stock todavía no están habilitados en esta
        versión.
      </p>
      <nav aria-label="Gestionar catálogo" className="flex flex-wrap gap-4">
        {can(actor.role, "productos") && (
          <Link href="/admin/productos" className="underline">
            Productos, precios y proveedores
          </Link>
        )}
        {can(actor.role, "categorias") && (
          <Link href="/admin/categorias" className="underline">
            Categorías
          </Link>
        )}
        {can(actor.role, "ajustes") && (
          <Link href="/admin/ajustes" className="underline">
            Contacto, diseño y políticas
          </Link>
        )}
        <Link href="/" className="underline">
          Ver tienda
        </Link>
      </nav>
    </section>
  );
}
