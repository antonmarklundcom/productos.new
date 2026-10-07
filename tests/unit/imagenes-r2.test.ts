import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxesFor,
  formatRef,
  jpegKeyFor,
  jpegSizeFor,
  keyFor,
  parseRef,
  publicBase,
} from "@/lib/imagenes-r2";
import { productImageSources, productImageUrl } from "@/lib/images";

const base = "cepillo-3f9a2c71d0";
const ref = `r2:p1/${base}@3024x4032`;
afterEach(() => vi.unstubAllEnvs());

describe("p1 image policy", () => {
  it.each([
    [500, 498, [240, 480]],
    [225, 145, [225]],
    [1000, 1000, [240, 480, 800, 1000]],
    [3024, 4032, [240, 480, 800, 1200]],
    [576, 500, [240, 480]],
    [577, 500, [240, 480, 577]],
    [1200, 900, [240, 480, 800, 1200]],
    [1, 1, [1]],
  ])("ladder for %sx%s", (w, h, boxes) => {
    expect(boxesFor(w, h)).toEqual(boxes);
    expect(boxesFor(w, h).every((b) => b <= Math.max(w, h))).toBe(true);
  });
  it("never invents sizes for invalid dimensions", () => {
    for (const n of [0, -1, 1.5, NaN, Infinity, 100_000])
      expect(boxesFor(n, 500)).toEqual([]);
  });
  it("reference round-trip and deterministic keys", () => {
    expect(formatRef(base, 3024, 4032)).toBe(ref);
    expect(parseRef(ref)).toEqual({ base, width: 3024, height: 4032 });
    expect(keyFor(base, 480)).toBe(`p1/${base}-480.webp`);
    expect(jpegKeyFor(base)).toBe(`p1/${base}.jpg`);
    expect(jpegSizeFor(3024, 4032)).toEqual({ width: 900, height: 1200 });
    expect(jpegSizeFor(225, 145)).toEqual({ width: 225, height: 145 });
    expect(jpegSizeFor(1, 99_999)).toEqual({ width: 1, height: 1200 });
  });
  it("rejects malformed refs, path tricks, uppercase and over-long slugs", () => {
    for (const bad of [
      "r2:p2/a-3f9a2c71d0@500x500",
      "r2:p1/../a-3f9a2c71d0@500x500",
      "r2:p1/a%2Fb-3f9a2c71d0@500x500",
      "r2:p1/A-3f9a2c71d0@500x500",
      "r2:p1/a-3F9A2C71D0@500x500",
      "r2:p1/a--b-3f9a2c71d0@500x500",
      "r2:p1/a-3f9a2c71d0@0x500",
      "r2:p1/a-3f9a2c71d0@0500x500",
      "r2:p1/a-3f9a2c71d0@100000x500",
      ref + "?x=1",
      ref + "\n",
      `r2:p1/${"a".repeat(81)}-3f9a2c71d0@500x500`,
      "a".repeat(256),
    ])
      expect(parseRef(bad)).toBeNull();
    expect(formatRef("bad/path", 500, 500)).toBeNull();
    expect(keyFor(base, 1201)).toBeNull();
  });
  it("publicBase accepts HTTPS and rejects unsafe or empty configuration", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGENES_URL", " https://img.test/// ");
    expect(publicBase()).toBe("https://img.test");
    for (const value of [
      "",
      "http://img.test",
      "not a url",
      "https://user:pass@img.test",
      "https://img.test?x=1",
      "https://img.test#x",
      "https://img.test/ bad",
    ]) {
      vi.stubEnv("NEXT_PUBLIC_IMAGENES_URL", value);
      expect(publicBase()).toBeNull();
      expect(productImageSources(ref)).toBeNull();
      expect(productImageUrl(ref)).toBeNull();
    }
  });
  it("uses actual widths for portrait srcset and JPEG for sharing", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGENES_URL", "https://img.test");
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    expect(productImageSources(ref)).toEqual({
      src: `https://img.test/p1/${base}-480.webp`,
      srcSet: [240, 480, 800, 1200]
        .map(
          (b) =>
            `https://img.test/p1/${base}-${b}.webp ${Math.round(b * 0.75)}w`
        )
        .join(", "),
      jpeg: `https://img.test/p1/${base}.jpg`,
    });
    expect(productImageUrl(ref, "thumb")?.endsWith(`${base}-240.webp`)).toBe(
      true
    );
    expect(productImageUrl(ref, "detail")?.endsWith(`${base}-1200.webp`)).toBe(
      true
    );
    expect(productImageUrl(ref, "og")?.endsWith(`${base}.jpg`)).toBe(true);
    const small = formatRef(base, 225, 145)!;
    expect(productImageUrl(small, "thumb")?.endsWith(`${base}-225.webp`)).toBe(
      true
    );
    expect(productImageSources(small)?.srcSet.endsWith(" 225w")).toBe(true);
    expect(productImageSources(formatRef(base, 1, 1000))).not.toBeNull();
    expect(
      productImageSources(formatRef(base, 1, 1000))?.srcSet.split(", ")
    ).toHaveLength(1);
    expect(productImageUrl("r2:bad")).toBeNull();
  });
});
