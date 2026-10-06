import { and, eq } from "drizzle-orm";
import type { MessageKey, Params } from "@/i18n";

import { DomainError } from "./errors";

import { getDb } from "@/db";
import { receipts } from "@/db/schema";

import type { Executor } from "./executor";
import { RECEIPT_MAX_BYTES } from "@/lib/upload-limits";

/**
 * Comprobantes de transferencia (PLAN.md 3.5).
 *
 * La validación vive acá y no en el componente: el formulario se puede
 * saltear con un `fetch`, así que el límite real es este.
 */

// El límite vive en `@/lib/upload-limits`: `next.config.ts` lo necesita para
// dejar pasar el body de la server action.
export { RECEIPT_MAX_BYTES } from "@/lib/upload-limits";
export const RECEIPT_MAX_PER_ORDER = 3;
export const RECEIPT_ALLOWED_MIME = ["image/jpeg", "image/png", "application/pdf"] as const;

/** Firmas de archivo: el `type` que manda el navegador es sólo una sugerencia. */
const MAGIC_NUMBERS: Array<{ mime: string; bytes: number[] }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
];

export class ReceiptError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = "ReceiptError";
  }
}

/** Detecta el tipo real por los primeros bytes. `null` si no reconoce ninguno. */
export function sniffMime(buffer: Buffer | Uint8Array): string | null {
  for (const candidate of MAGIC_NUMBERS) {
    const matches = candidate.bytes.every((byte, index) => buffer[index] === byte);
    if (matches) return candidate.mime;
  }
  return null;
}

export function validateReceipt(input: {
  declaredMime: string;
  bytes: number;
  content: Buffer | Uint8Array;
}): { mime: string } {
  if (input.bytes <= 0) {
    throw new ReceiptError("error.comprobante.vacio");
  }
  if (input.bytes > RECEIPT_MAX_BYTES) {
    throw new ReceiptError("error.comprobante.pesado");
  }

  const sniffed = sniffMime(input.content);
  if (!sniffed) {
    throw new ReceiptError("error.comprobante.formato");
  }
  // Si el navegador declaró otra cosa, mandan los bytes.
  if (!(RECEIPT_ALLOWED_MIME as readonly string[]).includes(sniffed)) {
    throw new ReceiptError("error.comprobante.formato");
  }

  return { mime: sniffed };
}

export async function countReceipts(orderId: number, executor?: Executor): Promise<number> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select({ id: receipts.id })
    .from(receipts)
    .where(eq(receipts.orderId, orderId));
  return rows.length;
}

export async function assertCanUpload(orderId: number, executor?: Executor): Promise<void> {
  const already = await countReceipts(orderId, executor);
  if (already >= RECEIPT_MAX_PER_ORDER) {
    throw new ReceiptError("error.comprobante.demasiados", {
      maximo: RECEIPT_MAX_PER_ORDER,
    });
  }
}

export async function recordReceipt(
  input: { orderId: number; cloudinaryId: string; mime: string; bytes: number },
  executor?: Executor
): Promise<void> {
  const tx = executor ?? getDb();
  await tx.insert(receipts).values({
    orderId: input.orderId,
    cloudinaryId: input.cloudinaryId,
    mime: input.mime,
    bytes: input.bytes,
    review: "pending",
  });
}

export async function listReceipts(orderId: number, executor?: Executor) {
  const tx = executor ?? getDb();
  return tx.select().from(receipts).where(eq(receipts.orderId, orderId));
}

export async function pendingReceipts(executor?: Executor) {
  const tx = executor ?? getDb();
  return tx
    .select()
    .from(receipts)
    .where(and(eq(receipts.review, "pending")));
}
