import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import {
  ACTION_BODY_MAX_BYTES,
  CATALOG_FILE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_BYTES,
  RECEIPT_MAX_BYTES,
} from "@/lib/upload-limits";

/**
 * Next corta el body de una server action en 1 MB y el del proxy en 10 MB si
 * `next.config.ts` no dice otra cosa. Un comprobante de 2 MB —la foto normal
 * de un celular— terminaba en un 413 antes de llegar a `validateReceipt`.
 */
describe("techo de las subidas", () => {
  const mayor = Math.max(RECEIPT_MAX_BYTES, PRODUCT_IMAGE_MAX_BYTES, CATALOG_FILE_MAX_BYTES);

  it("deja lugar al archivo más grande más el resto del multipart", () => {
    expect(ACTION_BODY_MAX_BYTES).toBeGreaterThan(mayor);
  });

  it("next.config.ts sube el límite de las server actions y del proxy", () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe(ACTION_BODY_MAX_BYTES);
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(ACTION_BODY_MAX_BYTES);
  });

  it("la acción de la planilla usa el mismo tope (tiene su propia copia)", () => {
    const accion = readFileSync("src/app/actions/admin-products.ts", "utf8");
    const match = /const MAX_CATALOG_FILE_BYTES = (\d+) \* 1024 \* 1024;/.exec(accion);
    // Una tienda que no trajo la carga por planilla no tiene el tope: no hay
    // nada que comparar (y este test le llega igual por template:sync).
    if (!/readCatalogFile/.test(accion)) return;
    expect(Number(match?.[1]) * 1024 * 1024).toBe(CATALOG_FILE_MAX_BYTES);
  });
});
