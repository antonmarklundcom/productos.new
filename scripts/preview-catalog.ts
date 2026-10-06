import "../src/lib/load-env";
import { and, eq, inArray } from "drizzle-orm";
import { closePool, getDb } from "@/db";
import { categories, productImages, products, variants } from "@/db/schema";
import { CATEGORIAS_INICIALES } from "@/config/tienda";
import { isLocalCatalogPreview, LOCAL_DEMO_PRICE_PYG } from "@/config/preview";
import { upsertCatalogProducts } from "./seed";

async function main() {
  if (process.env.NODE_ENV === "production" || !isLocalCatalogPreview())
    throw new Error(
      "Preview requires an isolated loopback preview_test database and non-production seeding."
    );
  const db = getDb();
  for (const [index, category] of CATEGORIAS_INICIALES.entries()) {
    await db
      .insert(categories)
      .values({
        slug: category.slug,
        name: category.name,
        description: category.description,
        position: index,
      })
      .onDuplicateKeyUpdate({
        set: { name: category.name, description: category.description },
      });
  }
  // Retire only the known examples from the first local preview. Never touch real catalog rows.
  await db
    .update(products)
    .set({ isActive: false })
    .where(
      inArray(products.slug, [
        "demo-organizador",
        "demo-herramientas",
        "demo-cuidado",
        "demo-comedero",
        "demo-botella",
      ])
    );
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, "tecnologia-y-accesorios"));
  await upsertCatalogProducts([
    {
      slug: "demo-auriculares",
      name: "Auriculares inalámbricos · DEMO",
      categoryId: category!.id,
      brand: null,
      ivaRate: 10,
      saleMode: "showcase",
      showPrice: false,
      description:
        "**Tu música. Tu momento.**\n\nUn paseo, una pausa o ese rato para concentrarte. Llevá tu música a donde te lleven tus planes, con un diseño simple que combina con tu día.\n\n**Pensados para acompañar tu día**\n\n- **Sin cables de por medio:** el concepto de este ejemplo es escuchar desde un dispositivo compatible mediante conexión inalámbrica.\n- **Comodidad a tu manera:** diseño de vincha ajustable y almohadillas que rodean la oreja en la imagen de referencia.\n- **Fáciles de llevar:** un formato compacto para pasar del escritorio a tu próximo plan.\n\n**Qué incluiría este ejemplo**\n\nUn par de auriculares, un cable de carga y una guía de uso. Color ilustrativo: negro. Antes de publicar un producto real, se verifica el contenido del empaque con el proveedor.\n\n**Antes de comprar**\n\nLa autonomía, versión de Bluetooth, compatibilidad, medidas y garantía se completan con la ficha técnica real del proveedor. No se atribuyen especificaciones que todavía no fueron verificadas.\n\n**Demostración local. No está a la venta.** Producto, fotografía y precio de ₲ 149.000 son ficticios y sirven únicamente para revisar la experiencia. No es un producto confirmado de Dropi y no se reciben pedidos.",
      variants: [
        {
          sku: "DEMO-AURICULARES",
          label: "Negro · ejemplo visual",
          pricePyg: LOCAL_DEMO_PRICE_PYG,
          compareAtPyg: null,
          onHand: 0,
        },
      ],
    },
  ]);
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.slug, "demo-auriculares"));
  // Remove only the retired zero-price variant from this isolated preview's earlier draft.
  await db
    .delete(variants)
    .where(
      and(eq(variants.productId, product!.id), eq(variants.sku, "DEMO-3"))
    );
  await db
    .update(products)
    .set({ isFeatured: true, isActive: true })
    .where(eq(products.id, product!.id));
  const images = await db
    .select({ id: productImages.id, position: productImages.position })
    .from(productImages)
    .where(eq(productImages.productId, product!.id));
  for (const [position, name] of [
    "auriculares",
    "auriculares-lifestyle",
  ].entries()) {
    const image = images.find((item) => item.position === position);
    const value = {
      cloudinaryId: `local-preview:${name}`,
      alt: "Auriculares negros — imagen ficticia de demostración",
      position,
    };
    if (image)
      await db
        .update(productImages)
        .set(value)
        .where(eq(productImages.id, image.id));
    else
      await db
        .insert(productImages)
        .values({ ...value, productId: product!.id });
  }
  console.log(
    "One local showcase demo prepared with a labeled sample price. No sellable stock, payment, delivery or customer data created."
  );
}
main()
  .catch(() => {
    console.error(
      "Local preview preparation failed; check the disposable environment and migrations."
    );
    process.exitCode = 1;
  })
  .finally(closePool);
