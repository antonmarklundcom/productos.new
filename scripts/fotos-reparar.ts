import fs from "node:fs/promises";
import path from "node:path";
import {
  parseManifest,
  parseOptions,
  PipelineError,
  repairItems,
  safeCode,
} from "./fotos-lib";

async function main(): Promise<void> {
  const args = parseOptions(
    process.argv.slice(2),
    ["--manifiesto", "--slug"],
    ["--aplicar", "--incluir-manuales"]
  );
  const manifest = parseManifest(
    JSON.parse(
      await fs.readFile(path.resolve(args.get("--manifiesto")!), "utf8")
    )
  );
  const slug = args.get("--slug")!;
  const items = repairItems(manifest, slug);
  // The dry run only checks the manifest. No connection to a store database.
  if (!args.has("--aplicar")) {
    console.log(
      JSON.stringify({ products: 1, photos: items.length, apply: false })
    );
    return;
  }
  if (!process.env.DATABASE_URL)
    throw new PipelineError("MISSING_DATABASE_URL");
  const { closePool, getDb } = await import("../src/db");
  try {
    const { eq } = await import("drizzle-orm");
    const { productImages, products } = await import("../src/db/schema");
    const { replaceProductImages } =
      await import("../src/domain/admin-products");
    const db = getDb();
    await db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.slug, slug))
        .limit(1)
        .for("update");
      if (!product) throw new PipelineError("PRODUCT_NOT_FOUND");
      const current = await tx
        .select({ ref: productImages.cloudinaryId })
        .from(productImages)
        .where(eq(productImages.productId, product.id));
      if (
        current.some((p) => !p.ref.startsWith("r2:")) &&
        !args.has("--incluir-manuales")
      )
        throw new PipelineError("MANUAL_PHOTOS_PRESENT");
      await replaceProductImages(product.id, items, tx);
    });
    console.log(
      JSON.stringify({ products: 1, photos: items.length, apply: true })
    );
  } finally {
    await closePool();
  }
}
main().catch((error: unknown) => {
  console.error(safeCode(error));
  process.exitCode = 1;
});
