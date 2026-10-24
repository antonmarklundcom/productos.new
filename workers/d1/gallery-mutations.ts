import { createHash, randomUUID } from "node:crypto";
import type { D1Binding } from "./database";
import {
  catalogConflict,
  productAuditStatements,
  revisionGuard,
} from "./catalog-durability";
export type GalleryMutation = {
  productId: number;
  expectedRevision: number;
  operationId: string;
};
/** Keep the p1 protocol's final ten-hex suffix while retaining 80 bits of
 * deterministic upload identity in two hash segments. */
export function mutationImageBase(
  prefix: string,
  actorId: number,
  operationId: string
) {
  const digest = createHash("sha256")
    .update(actorId + ":" + operationId)
    .digest("hex")
    .slice(0, 20);
  return (
    prefix.slice(0, 50).replace(/-+$/g, "") +
    "-" +
    digest.slice(0, 10) +
    "-" +
    digest.slice(10)
  );
}
export function mutationFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function mutationId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value))
    throw new Error("Identidad de operación inválida.");
}
export async function mutationReceipt(
  db: D1Binding,
  id: string,
  actorId: number,
  fingerprint: string
) {
  const row = await db
    .prepare(
      "SELECT actor_id,fingerprint,result_json FROM admin_mutation_receipts WHERE id=?"
    )
    .bind(id)
    .first<{ actor_id: number; fingerprint: string; result_json: string }>();
  if (row && (row.actor_id !== actorId || row.fingerprint !== fingerprint))
    throw new Error("La operación pertenece a otro usuario o borrador.");
  const value = row
    ? (JSON.parse(row.result_json) as {
        revision: number;
        tombstoneId?: string;
        snapshot?: string;
        pending?: boolean;
      })
    : null;
  return value?.pending ? null : value;
}
export function receiptStatement(
  db: D1Binding,
  id: string,
  actorId: number,
  productId: number | null,
  fingerprint: string,
  result: unknown,
  kind: string
) {
  return db
    .prepare(
      "INSERT INTO admin_mutation_receipts(id,actor_id,product_id,fingerprint,result_json,kind) VALUES(?,?,?,?,?,?)"
    )
    .bind(id, actorId, productId, fingerprint, JSON.stringify(result), kind);
}
export async function mutateGallery(
  db: D1Binding,
  actorId: number,
  input: GalleryMutation & {
    kind: "alt" | "reorder" | "remove" | "restore";
    imageId?: number;
    alt?: string;
    imageIds?: number[];
    tombstoneId?: string;
  }
) {
  mutationId(input.operationId);
  if (!Number.isSafeInteger(input.productId) || input.productId < 1)
    throw new Error("Producto inválido.");
  const fingerprint = mutationFingerprint(input),
    replay = await mutationReceipt(db, input.operationId, actorId, fingerprint);
  if (replay) return replay;
  const prep = (text: string, ...values: (string | number | null)[]) =>
    db.prepare(text).bind(...values);
  const statements = [
      revisionGuard(db, input.productId, input.expectedRevision),
    ],
    result = {
      revision: input.expectedRevision + 1,
      tombstoneId: undefined as string | undefined,
    };
  if (input.kind === "reorder") {
    const ids = input.imageIds;
    if (
      !ids ||
      !ids.length ||
      ids.length > 50 ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 1) ||
      new Set(ids).size !== ids.length
    )
      throw new Error("Orden de fotos inválido.");
    statements.push(
      prep(
        "INSERT INTO counters(name,value) SELECT ?,-1 WHERE (SELECT COUNT(*) FROM product_images WHERE product_id=?)<>? OR EXISTS(SELECT 1 FROM product_images WHERE product_id=? AND id NOT IN(SELECT value FROM json_each(?)))",
        randomUUID(),
        input.productId,
        ids.length,
        input.productId,
        JSON.stringify(ids)
      )
    );
    statements.push(
      prep(
        "UPDATE product_images SET position=(SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=product_images.id) WHERE product_id=?",
        JSON.stringify(ids),
        input.productId
      )
    );
  } else if (input.kind === "restore") {
    const row = await db
      .prepare(
        "SELECT * FROM gallery_tombstones WHERE id=? AND actor_id=? AND product_id=? AND restored_at IS NULL AND expires_at>CURRENT_TIMESTAMP"
      )
      .bind(input.tombstoneId ?? "", actorId, input.productId)
      .first<{
        image_id: number;
        cloudinary_id: string;
        alt: string | null;
        position: number;
      }>();
    if (!row) throw new Error("La restauración ya se usó o venció.");
    statements.push(
      prep(
        "INSERT INTO counters(name,value) SELECT ?,-1 WHERE NOT EXISTS(SELECT 1 FROM gallery_tombstones WHERE id=? AND actor_id=? AND restored_at IS NULL AND expires_at>CURRENT_TIMESTAMP)",
        randomUUID(),
        input.tombstoneId!,
        actorId
      )
    );
    statements.push(
      prep(
        "UPDATE product_images SET position=position+1 WHERE product_id=? AND position>=?",
        input.productId,
        row.position
      )
    );
    statements.push(
      prep(
        "INSERT INTO product_images(id,product_id,cloudinary_id,alt,position) VALUES(?,?,?,?,?)",
        row.image_id,
        input.productId,
        row.cloudinary_id,
        row.alt,
        row.position
      )
    );
    statements.push(
      prep(
        "UPDATE gallery_tombstones SET restored_at=CURRENT_TIMESTAMP WHERE id=?",
        input.tombstoneId!
      )
    );
  } else {
    if (!Number.isSafeInteger(input.imageId) || input.imageId! < 1)
      throw new Error("Foto inválida.");
    statements.push(
      prep(
        "INSERT INTO counters(name,value) SELECT ?,-1 WHERE NOT EXISTS(SELECT 1 FROM product_images WHERE id=? AND product_id=?)",
        randomUUID(),
        input.imageId!,
        input.productId
      )
    );
    if (input.kind === "alt") {
      if (typeof input.alt !== "string" || input.alt.trim().length > 255)
        throw new Error("La descripción admite hasta 255 caracteres.");
      statements.push(
        prep(
          "UPDATE product_images SET alt=? WHERE id=? AND product_id=?",
          input.alt.trim() || null,
          input.imageId!,
          input.productId
        )
      );
    } else {
      result.tombstoneId = randomUUID();
      statements.push(
        prep(
          "INSERT INTO gallery_tombstones(id,actor_id,product_id,image_id,cloudinary_id,alt,position,expires_at) SELECT ?,?,product_id,id,cloudinary_id,alt,position,datetime('now','+1 day') FROM product_images WHERE id=? AND product_id=?",
          result.tombstoneId,
          actorId,
          input.imageId!,
          input.productId
        )
      );
      statements.push(
        prep(
          "DELETE FROM product_images WHERE id=? AND product_id=?",
          input.imageId!,
          input.productId
        )
      );
    }
  }
  statements.push(
    ...productAuditStatements(
      db,
      actorId,
      input.productId,
      input.kind + "-image",
      ["images"]
    ),
    receiptStatement(
      db,
      input.operationId,
      actorId,
      input.productId,
      fingerprint,
      result,
      input.kind + "-image"
    )
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const receipt = await mutationReceipt(
      db,
      input.operationId,
      actorId,
      fingerprint
    );
    if (receipt) return receipt;
    const current = await db
      .prepare("SELECT revision FROM products WHERE id=?")
      .bind(input.productId)
      .first<number>("revision");
    if (current !== input.expectedRevision) throw catalogConflict();
    throw error;
  }
  return result;
}

/** Reserve before touching deterministic R2 keys, preventing concurrent reuse
 * of one operation identity for different bytes. Pending reservations survive
 * interrupted uploads and can resume only with the same actor and payload. */
export async function reserveImageMutation(
  db: D1Binding,
  id: string,
  actorId: number,
  productId: number | null,
  fingerprint: string,
  kind: string
) {
  await db
    .prepare(
      "INSERT INTO admin_mutation_receipts(id,actor_id,product_id,fingerprint,result_json,kind) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING"
    )
    .bind(
      id,
      actorId,
      productId,
      fingerprint,
      '{"pending":true}',
      kind + "-pending"
    )
    .run();
  return mutationReceipt(db, id, actorId, fingerprint);
}
export function finalizeImageMutation(
  db: D1Binding,
  id: string,
  actorId: number,
  fingerprint: string,
  result: unknown,
  kind: string
) {
  return db
    .prepare(
      "UPDATE admin_mutation_receipts SET result_json=?,kind=? WHERE id=? AND actor_id=? AND fingerprint=?"
    )
    .bind(JSON.stringify(result), kind, id, actorId, fingerprint);
}
