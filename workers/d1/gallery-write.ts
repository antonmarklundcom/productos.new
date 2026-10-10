import type { D1Binding, ImagesBucket } from "./database";

type GalleryFile = { key: string; bytes: Uint8Array; mime: string };

/** R2 and D1 cannot share a transaction. Never delete files after attempting
 * the database insert: a lost response could conceal a committed gallery row. */
export async function storeGalleryFiles(
  db: D1Binding, bucket: ImagesBucket, productId: number, ref: string,
  alt: string | null, files: readonly GalleryFile[]
) {
  try {
    for (const file of files) await bucket.put(file.key, file.bytes, {
      httpMetadata: { contentType: file.mime, cacheControl: "public, max-age=31536000, immutable" },
    });
  } catch (error) {
    // Names belong exclusively to this new upload. Include a failed put whose
    // acknowledgement might have been lost, before any gallery write exists.
    await bucket.delete(files.map(file => file.key)).catch(() => {});
    throw error;
  }
  const result = await db.prepare(`INSERT INTO product_images(product_id,cloudinary_id,alt,position)
    VALUES(?,?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM product_images WHERE product_id=?))`)
    .bind(productId, ref, alt, productId).run();
  if (!result.success) throw new Error("D1_GALLERY_WRITE_FAILED");
}
