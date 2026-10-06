import { describe, expect, it } from "vitest";

import {
  RECEIPT_MAX_BYTES,
  ReceiptError,
  sniffMime,
  validateReceipt,
} from "@/domain/receipts";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");

describe("sniffMime", () => {
  it("reconoce JPG, PNG y PDF por sus bytes", () => {
    expect(sniffMime(jpeg)).toBe("image/jpeg");
    expect(sniffMime(png)).toBe("image/png");
    expect(sniffMime(pdf)).toBe("application/pdf");
  });

  it("no reconoce otros formatos", () => {
    expect(sniffMime(svg)).toBeNull();
    expect(sniffMime(Buffer.from([0x00, 0x01]))).toBeNull();
  });
});

describe("validateReceipt", () => {
  it("acepta un comprobante válido", () => {
    expect(validateReceipt({ declaredMime: "image/jpeg", bytes: jpeg.length, content: jpeg })).toEqual({
      mime: "image/jpeg",
    });
  });

  it("manda lo que dicen los bytes, no el content-type del navegador", () => {
    // Un SVG disfrazado de JPG: el navegador miente, los bytes no.
    expect(() =>
      validateReceipt({ declaredMime: "image/jpeg", bytes: svg.length, content: svg })
    ).toThrow(ReceiptError);

    // Y al revés: un PNG declarado como PDF se guarda como PNG.
    expect(
      validateReceipt({ declaredMime: "application/pdf", bytes: png.length, content: png })
    ).toEqual({ mime: "image/png" });
  });

  it("rechaza archivos vacíos", () => {
    expect(() =>
      validateReceipt({ declaredMime: "image/png", bytes: 0, content: Buffer.alloc(0) })
    ).toThrow(/vacío/);
  });

  it("rechaza más de 5 MB", () => {
    expect(() =>
      validateReceipt({ declaredMime: "image/png", bytes: RECEIPT_MAX_BYTES + 1, content: png })
    ).toThrow(/5 MB/);
  });

  it("acepta justo en el límite", () => {
    expect(
      validateReceipt({ declaredMime: "image/png", bytes: RECEIPT_MAX_BYTES, content: png })
    ).toEqual({ mime: "image/png" });
  });
});
