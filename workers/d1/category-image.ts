import { randomUUID, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  requireOwnerSession,
  adminActionError,
} from "../../src/lib/admin-guard";
import { getNativeDb, getD1Bindings } from "./database";
import {
  boxesFor,
  keyFor,
  jpegKeyFor,
  formatRef,
  sizeForBox,
} from "../../src/lib/imagenes-r2";
import { preparedImageDimensions } from "./image-validation";
import {
  mutationId,
  mutationImageBase,
  mutationFingerprint,
  mutationReceipt,
  reserveImageMutation,
  finalizeImageMutation,
} from "./gallery-mutations";
export async function uploadD1CategoryImage(data: FormData) {
  try {
    const actor = await requireOwnerSession(),
      db = getNativeDb().$client,
      bucket = getD1Bindings().IMAGES,
      id = Number(data.get("categoryId"));
    const operationId = data.get("operationId");
    mutationId(operationId);
    if (!bucket || !Number.isSafeInteger(id) || id < 1)
      throw new Error("Categoría o almacenamiento no disponible.");
    const width = Number(data.get("imageWidth")),
      height = Number(data.get("imageHeight"));
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      Math.max(width, height) > 1200
    )
      throw new Error("Prepará la foto antes de subirla.");
    const base = mutationImageBase(
        "categoria-" + id,
        actor.userId,
        operationId
      ),
      ref = formatRef(base, width, height);
    if (!ref) throw new Error("Referencia de imagen inválida.");
    const files: { key: string; bytes: Uint8Array; mime: string }[] = [];
    let total = 0;
    const specs: [string, string, string, number][] = [
      ...boxesFor(width, height).map(
        (box) =>
          ["webp" + box, keyFor(base, box)!, "image/webp", box] as [
            string,
            string,
            string,
            number,
          ]
      ),
      ["jpeg", jpegKeyFor(base)!, "image/jpeg", Math.max(width, height)],
    ];
    for (const [field, key, mime, box] of specs) {
      const file = data.get(field);
      if (!(file instanceof File) || !file.size || file.size > 800 * 1024)
        throw new Error("Falta una versión preparada de la foto.");
      const bytes = new Uint8Array(await file.arrayBuffer()),
        actual = preparedImageDimensions(bytes, mime),
        expected = sizeForBox(width, height, box)!;
      if (
        !actual ||
        actual.width !== expected.width ||
        actual.height !== expected.height
      )
        throw new Error("Formato o tamaño inválido.");
      total += bytes.length;
      files.push({ key, bytes, mime });
    }
    if (total > 800 * 1024)
      throw new Error("La foto preparada es demasiado pesada.");
    const alt = String(data.get("alt") ?? "").trim();
    if (alt.length > 200)
      throw new Error("La descripción admite hasta 200 caracteres.");
    const snapshot = String(data.get("expectedSnapshot") ?? ""),
      fingerprint = mutationFingerprint({
        id,
        ref,
        alt,
        snapshot,
        hashes: files.map((file) =>
          createHash("sha256").update(file.bytes).digest("hex")
        ),
      });
    const values = JSON.parse(snapshot) as unknown[];
    if (!Array.isArray(values) || values.length !== 7)
      throw new Error(
        "La categoría cambió; recargá para comparar el borrador."
      );
    values[3] = ref;
    values[4] = alt || null;
    const nextSnapshot = JSON.stringify(values);
    const receipt = await reserveImageMutation(
      db,
      operationId,
      actor.userId,
      null,
      fingerprint,
      "category-image"
    );
    if (receipt) return { ok: true as const, snapshot: receipt.snapshot };
    // Retain bytes after any uncertain write: another identical request can have committed.
    for (const file of files)
      await bucket.put(file.key, file.bytes, {
        httpMetadata: {
          contentType: file.mime,
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
    const guard = db
      .prepare(
        "INSERT INTO counters(name,value) SELECT ?,-1 WHERE NOT EXISTS(SELECT 1 FROM categories WHERE id=? AND json_array(slug,name,description,image_cloudinary_id,image_alt,is_active,position)=?)"
      )
      .bind(randomUUID(), id, snapshot);
    try {
      await db.batch([
        guard,
        db
          .prepare(
            "UPDATE categories SET image_cloudinary_id=?,image_alt=? WHERE id=?"
          )
          .bind(ref, alt || null, id),
        db
          .prepare(
            "UPDATE products SET revision=revision+1 WHERE category_id=?"
          )
          .bind(id),
        db
          .prepare(
            "INSERT INTO catalog_audit(id,actor_id,operation,record_type,record_id,revision,fields) VALUES(?,?,'category-image','category',?,1,'[\"images\"]')"
          )
          .bind(randomUUID(), actor.userId, id),
        finalizeImageMutation(
          db,
          operationId,
          actor.userId,
          fingerprint,
          { revision: 1, snapshot: nextSnapshot },
          "category-image"
        ),
      ]);
    } catch (error) {
      if (!(await mutationReceipt(db, operationId, actor.userId, fingerprint)))
        throw error;
    }
    revalidatePath("/admin/categorias");
    revalidatePath("/", "layout");
    return { ok: true as const, snapshot: nextSnapshot };
  } catch (error) {
    return adminActionError("uploadCategoryImage", error);
  }
}
