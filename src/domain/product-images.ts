import { AdminInputError } from "./admin-products";
import { PRODUCT_IMAGE_MAX_BYTES } from "@/lib/upload-limits";

/**
 * Validación de las fotos de producto (PLAN.md 4.6).
 *
 * Mismo criterio que los comprobantes: el tipo se decide por los primeros
 * bytes, no por el `type` que declara el navegador. Es un campo de texto que
 * manda el cliente — `image/png` en la cabecera y un `.svg` con un `<script>`
 * adentro es el camino corto a un XSS servido desde nuestro propio CDN.
 *
 * SVG queda afuera a propósito, justamente por eso.
 */

// Ver `@/lib/upload-limits` (lo lee también `next.config.ts`).
export { PRODUCT_IMAGE_MAX_BYTES } from "@/lib/upload-limits";

const MAGIC: Array<{ mime: string; bytes: number[] }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  // WebP es RIFF: "RIFF" + 4 bytes de tamaño + "WEBP". Los bytes 4–7 varían,
  // así que se chequean los dos extremos por separado.
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
];

export function sniffImageMime(buffer: Buffer | Uint8Array): string | null {
  for (const candidate of MAGIC) {
    if (!candidate.bytes.every((byte, index) => buffer[index] === byte)) continue;
    if (candidate.mime === "image/webp") {
      const isWebp =
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
      if (!isWebp) continue;
    }
    return candidate.mime;
  }
  return null;
}

export function validateProductImage(input: {
  bytes: number;
  content: Buffer | Uint8Array;
}): { mime: string } {
  if (input.bytes <= 0) {
    throw new AdminInputError("adminError.foto.vacia");
  }
  if (input.bytes > PRODUCT_IMAGE_MAX_BYTES) {
    throw new AdminInputError("adminError.foto.pesada");
  }

  const mime = sniffImageMime(input.content);
  if (!mime) {
    throw new AdminInputError("adminError.foto.formato");
  }
  return { mime };
}
