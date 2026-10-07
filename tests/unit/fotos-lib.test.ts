import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/lib/csv";
import {
  assertByteCap,
  assertPixelCap,
  buildImagePlan,
  htmlEscape,
  imageFlags,
  manifestTotals,
  mergeManifestScope,
  MAX_INPUT_PIXELS,
  MAX_SOURCE_BYTES,
  parseManifest,
  parseOptions,
  readCatalog,
  repairItems,
  reportRows,
  retryDelay,
  retryableStatus,
  rewriteImportCsv,
  safeCode,
  sniffFormat,
  sourceAllowed,
  uniqueObjects,
  type Photo,
  type PhotoManifest,
} from "../../scripts/fotos-lib";

const source = "https://d39ru7awumhhs2.cloudfront.net/photo.jpg";
const sha = "a".repeat(64);
function photo(overrides: Partial<Photo> = {}): Photo {
  const plan = buildImagePlan("cepillo", sha, 500, 498);
  return {
    dropiId: "123",
    sku: "TEST-1",
    slug: "cepillo",
    name: "Cepillo",
    position: 0,
    sourceUrl: source,
    status: "ok",
    httpStatus: 200,
    bytes: 500,
    sha256: sha,
    format: "jpeg",
    width: 500,
    height: 498,
    pages: 1,
    alphaUsed: false,
    flags: ["non-square"],
    ref: plan.ref,
    original: `originals/${sha}.jpeg`,
    objects: plan.objects.map((object) => ({
      key: object.key,
      format: object.format,
      width: object.width,
      height: object.height,
      bytes: 100,
      sha256: "b".repeat(64),
      uploadStatus: "pending",
    })),
    timings: { downloadMs: 10, encodeMs: 20, totalMs: 30 },
    error: null,
    ...overrides,
  };
}
function manifest(photos = [photo()]): PhotoManifest {
  return {
    version: 1,
    policy: "p1",
    createdAt: "2026-10-06T00:00:00Z",
    updatedAt: "2026-10-06T00:00:00Z",
    products: [
      {
        sku: "TEST-1",
        skus: ["TEST-1"],
        slug: "cepillo",
        name: "Cepillo",
        dropiId: "123",
        sources: [source],
      },
    ],
    photos,
    elapsedMs: 30,
  };
}

describe("local photo pipeline", () => {
  it("allows only unsigned HTTPS sources on the exact supplier host", () => {
    expect(sourceAllowed(source)).toBe(true);
    for (const bad of [
      "http://d39ru7awumhhs2.cloudfront.net/a",
      "https://img.test/a",
      "https://d39ru7awumhhs2.cloudfront.net.img.test/a",
      "https://user:pass@d39ru7awumhhs2.cloudfront.net/a",
      "https://d39ru7awumhhs2.cloudfront.net:444/a",
      source + "?token=private",
      source + "#fragment",
      "bad",
    ])
      expect(sourceAllowed(bad)).toBe(false);
  });
  it("detects magic bytes rather than trusting extensions or Content-Type", () => {
    expect(sniffFormat(Uint8Array.from([255, 216, 255]))).toBe("jpeg");
    expect(
      sniffFormat(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ).toBe("png");
    expect(sniffFormat(new TextEncoder().encode("RIFF0000WEBP"))).toBe("webp");
    expect(sniffFormat(new TextEncoder().encode("GIF89a"))).toBe("gif");
    expect(sniffFormat(new TextEncoder().encode("GIF87a"))).toBe("gif");
    for (const input of ["<svg/>", "<html>", "RIFF", "GIF90a", "0000WEBP"])
      expect(sniffFormat(new TextEncoder().encode(input))).toBeNull();
  });
  it("checks both declared and accumulated byte counts and decoded pixel limits", () => {
    expect(() => assertByteCap(MAX_SOURCE_BYTES)).not.toThrow();
    for (const size of [MAX_SOURCE_BYTES + 1, -1, Infinity, NaN, 1.5])
      expect(() => assertByteCap(size)).toThrow("BYTE_CAP");
    expect(() =>
      assertPixelCap(10_000, MAX_INPUT_PIXELS / 10_000)
    ).not.toThrow();
    for (const [w, h] of [
      [10_000, 5001],
      [100_000, 1],
      [0, 500],
      [1.5, 500],
    ])
      expect(() => assertPixelCap(w!, h!)).toThrow("PIXEL_CAP");
  });
  it("retries only transient HTTP statuses, with exactly three backoffs", () => {
    for (const status of [429, 500, 503, 599])
      expect(retryableStatus(status)).toBe(true);
    for (const status of [200, 302, 403, 404, 412, 600])
      expect(retryableStatus(status)).toBe(false);
    expect([0, 1, 2, 3].map(retryDelay)).toEqual([1000, 4000, 10_000, null]);
  });
  it("builds p1 keys with bounded slugs, native sizes, correct portraits and no supplier IDs", () => {
    const small = buildImagePlan("adaptador", sha, 225, 145);
    expect(small.ref).toBe("r2:p1/adaptador-aaaaaaaaaa@225x145");
    expect(small.objects.map((o) => [o.key, o.width, o.height])).toEqual([
      ["p1/adaptador-aaaaaaaaaa-225.webp", 225, 145],
      ["p1/adaptador-aaaaaaaaaa.jpg", 225, 145],
    ]);
    const portrait = buildImagePlan(
      "a".repeat(79) + "-truncated",
      sha,
      3024,
      4032
    );
    expect(portrait.ref).toContain("a".repeat(79) + "-aaaaaaaaaa@");
    expect(portrait.objects.at(-1)).toMatchObject({
      width: 900,
      height: 1200,
      format: "jpeg",
    });
    expect(
      buildImagePlan("cepillo", sha, 500, 498)
        .objects.filter((o) => o.format === "webp")
        .map((o) => o.box)
    ).toEqual([240, 480]);
    expect(() => buildImagePlan("../bad", sha, 500, 500)).toThrow();
    expect(() => buildImagePlan("cepillo", "bad", 500, 500)).toThrow();
    expect(imageFlags(225, 145, 2, true)).toEqual([
      "small",
      "animated",
      "alpha",
      "non-square",
    ]);
  });
  it("keeps columns, prices and all variant rows while replacing only Fotos", () => {
    const input =
      'SKU,Producto,Precio (₲),Stock,Slug,Fotos,Extra\nTEST-1,Cepillo,"₲ 10.000",,cepillo,' +
      source +
      ',"texto, con coma"\nTEST-2,Cepillo,000123,0,cepillo,,segundo\nNO-1,Sin foto,999,7,sin-foto,,tercero\n';
    const document = readCatalog(input);
    const rewritten = parseCsv(rewriteImportCsv(document, [photo()]));
    expect(rewritten[0]).toEqual(document.headers);
    expect(rewritten).toHaveLength(3);
    expect(rewritten[1]).toEqual([
      "TEST-1",
      "Cepillo",
      "₲ 10.000",
      "",
      "cepillo",
      photo().ref!,
      "texto, con coma",
    ]);
    expect(rewritten[2]).toEqual([
      "TEST-2",
      "Cepillo",
      "000123",
      "0",
      "cepillo",
      "",
      "segundo",
    ]);
    const subset = readCatalog(input, ["TEST-2"]);
    expect(subset.rows.map((row) => row[0])).toEqual(["TEST-1", "TEST-2"]);
    expect(() => readCatalog(input, ["NOT-FOUND"])).toThrow("SKU_NOT_FOUND");
    expect(() => readCatalog("SKU;Producto\nX;Cepillo")).toThrow("CSV_COLUMNS");
  });
  it("reports missing and partial photos without creating a placeholder import", () => {
    const document = readCatalog(
      `SKU;Producto;Slug;Fotos\nTEST-1;Cepillo;cepillo;${source}|${source.replace("photo", "other")}\nNO-1;Sin foto;sin-foto;\n`
    );
    const failed = photo({
      position: 1,
      status: "failed",
      ref: null,
      objects: [],
      error: "HTTP_404",
    });
    const rows = reportRows(document.products, [photo(), failed]);
    expect(rows).toMatchObject([
      { status: "partial", successful: 1, failed: 1, errors: "HTTP_404" },
      { status: "sin_fotos", successful: 0 },
    ]);
    expect(parseCsv(rewriteImportCsv(document, [failed]))).toHaveLength(1);
  });
  it("deduplicates identical object sets across products and refuses conflicting bytes", () => {
    const second = photo({ slug: "otro", sku: "TEST-2" });
    expect(uniqueObjects([photo(), second])).toHaveLength(3);
    expect(manifestTotals(manifest([photo(), second]))).toMatchObject({
      photos: 2,
      objects: 3,
      bytes: 300,
      flaggedPhotos: 2,
      pendingObjects: 3,
    });
    const changed = photo();
    changed.objects[0]!.bytes++;
    expect(() => uniqueObjects([photo(), changed])).toThrow("OBJECT_CONFLICT");
  });
  it("validates manifests before local file access, upload or repair", () => {
    expect(parseManifest(manifest())).toEqual(manifest());
    const unsafe = manifest();
    unsafe.photos[0]!.objects[0]!.key = "../private";
    expect(() => parseManifest(unsafe)).toThrow("MANIFEST_INVALID");
    const incorrect = manifest();
    incorrect.photos[0]!.objects[0]!.width++;
    expect(() => parseManifest(incorrect)).toThrow("MANIFEST_INVALID");
    const original = manifest();
    original.photos[0]!.original = "../private";
    expect(() => parseManifest(original)).toThrow("MANIFEST_INVALID");
    expect(() => parseManifest({ version: 1 })).toThrow("MANIFEST_INVALID");
    expect(() =>
      parseManifest({ ...manifest(), unknownCredential: "do-not-copy" })
    ).toThrow("MANIFEST_INVALID");
    const wrongOriginal = manifest();
    wrongOriginal.photos[0]!.original = `originals/${"c".repeat(64)}.jpeg`;
    expect(() => parseManifest(wrongOriginal)).toThrow("MANIFEST_INVALID");
    const failedArchive = manifest([
      photo({
        status: "failed",
        ref: null,
        objects: [],
        format: "../private.jpg" as Photo["format"],
        original: `originals/${sha}.../private.jpg`,
        error: "HTTP_404",
      }),
    ]);
    expect(() => parseManifest(failedArchive)).toThrow("MANIFEST_INVALID");
  });
  it("keeps hash/upload history outside the selected SKU scope", () => {
    const previous = manifest();
    const other = {
      ...previous.products[0]!,
      sku: "TEST-2",
      skus: ["TEST-2"],
      slug: "otro",
    };
    const scope = mergeManifestScope(previous, [other]);
    expect(scope.products.map((p) => p.slug)).toEqual(["cepillo", "otro"]);
    expect(scope.photos).toEqual(previous.photos);
    expect(mergeManifestScope(previous, previous.products).photos).toEqual([]);
  });
  it("refuses gallery repair until every referenced object is marked uploaded", () => {
    const data = manifest();
    expect(() => repairItems(data, "cepillo")).toThrow("OBJECTS_NOT_UPLOADED");
    data.photos[0]!.objects.forEach((o) => {
      o.uploadStatus = "uploaded";
    });
    expect(repairItems(data, "cepillo")).toEqual([
      { ref: photo().ref, alt: "Cepillo" },
    ]);
    data.photos[0]!.objects[1]!.uploadStatus = "failed";
    expect(() => repairItems(data, "cepillo")).toThrow("OBJECTS_NOT_UPLOADED");
  });
  it("never reports raw transport errors and escapes supplier text in local HTML", () => {
    expect(safeCode(new Error("private transport details"))).toBe(
      "LOCAL_IO_OR_DECODE_ERROR"
    );
    expect(htmlEscape('<img src="x"> &')).toBe(
      "&lt;img src=&quot;x&quot;&gt; &amp;"
    );
    expect(
      parseOptions(
        ["--manifiesto", "file"],
        ["--manifiesto"],
        ["--aplicar"]
      ).has("--aplicar")
    ).toBe(false);
    expect(() =>
      parseOptions(["--aplicar"], ["--manifiesto"], ["--aplicar"])
    ).toThrow();
    expect(() =>
      parseOptions(["--manifiesto", "file", "--unknown"], ["--manifiesto"])
    ).toThrow();
  });
});
