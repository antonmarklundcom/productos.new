import { mutationFingerprint, mutationId, mutationReceipt, reserveImageMutation, finalizeImageMutation } from "./gallery-mutations";
import { createHash } from "node:crypto";
import { revisionGuard, productAuditStatements } from "./catalog-durability";
import type { D1Binding, ImagesBucket } from "./database";

type GalleryFile = { key: string; bytes: Uint8Array; mime: string };

/** R2 and D1 cannot share a transaction. Never delete files after attempting
 * the database insert: a lost response could conceal a committed gallery row. */
export async function storeGalleryFiles(
  db: D1Binding, bucket: ImagesBucket, productId: number, ref: string,
  alt: string | null, files: readonly GalleryFile[], actorId?:number, mutation?:{operationId:string;expectedRevision:number}
) {
  const fingerprint=mutationFingerprint({productId,ref,alt,expectedRevision:mutation?.expectedRevision,files:files.map(file=>({key:file.key,hash:createHash("sha256").update(file.bytes).digest("hex")}))});
  if(mutation&&actorId!==undefined){mutationId(mutation.operationId);const replay=await reserveImageMutation(db,mutation.operationId,actorId,productId,fingerprint,"image-upload");if(replay)return replay;}
  try {
    for (const file of files) await bucket.put(file.key, file.bytes, {
      httpMetadata: { contentType: file.mime, cacheControl: "public, max-age=31536000, immutable" },
    });
  } catch (error) {
    // Names belong exclusively to this new upload. Include a failed put whose
    // acknowledgement might have been lost, before any gallery write exists.
    if(!mutation)await bucket.delete(files.map(file => file.key)).catch(() => {});
    throw error;
  }
  const insert = db.prepare(`INSERT INTO product_images(product_id,cloudinary_id,alt,position)
    VALUES(?,?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM product_images WHERE product_id=?))`)
    .bind(productId, ref, alt, productId);
  const resultValue={revision:mutation?mutation.expectedRevision+1:0};
  const statements=actorId===undefined?[insert]:[...(mutation?[revisionGuard(db,productId,mutation.expectedRevision)]:[]),insert,...productAuditStatements(db,actorId,productId,"add-image",["images"]),...(mutation?[finalizeImageMutation(db,mutation.operationId,actorId,fingerprint,resultValue,"image-upload")]:[])];
  let result;
  try{result=await db.batch(statements);}catch(error){if(mutation&&actorId!==undefined){const replay=await mutationReceipt(db,mutation.operationId,actorId,fingerprint);if(replay)return replay;}throw error;}
  if (result.some((row:{success:boolean})=>!row.success)) throw new Error("D1_GALLERY_WRITE_FAILED");
  return resultValue;
}
