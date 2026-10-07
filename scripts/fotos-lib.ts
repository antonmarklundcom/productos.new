/** Pure helpers for the local-only p1 pipeline. No credentials, I/O or network. */
import { parseCsv, toCsv } from "../src/lib/csv";
import { slugify } from "../src/lib/slug";
import {
  boxesFor,
  formatRef,
  jpegKeyFor,
  jpegSizeFor,
  keyFor,
  parseRef,
  sizeForBox,
} from "../src/lib/imagenes-r2";

export const SOURCE_HOSTS = ["d39ru7awumhhs2.cloudfront.net"] as const;
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 50_000_000;
export const RETRY_DELAYS = [1000, 4000, 10_000] as const;
export type ImageFormat = "jpeg" | "png" | "webp" | "gif";
export type PhotoFlag = "small" | "animated" | "alpha" | "non-square";
export type PhotoObject = {
  key: string;
  format: "webp" | "jpeg";
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  uploadStatus: "pending" | "uploaded" | "failed";
  uploadedAt?: string;
  uploadHttpStatus?: number;
  uploadError?: string;
};
export type Photo = {
  dropiId: string | null;
  sku: string;
  slug: string;
  name: string;
  position: number;
  sourceUrl: string;
  status: "ok" | "failed";
  httpStatus: number | null;
  bytes: number;
  sha256: string | null;
  format: ImageFormat | null;
  width: number | null;
  height: number | null;
  pages: number | null;
  alphaUsed: boolean;
  flags: PhotoFlag[];
  ref: string | null;
  original: string | null;
  objects: PhotoObject[];
  timings: { downloadMs: number; encodeMs: number; totalMs: number };
  error: string | null;
  verification?: {
    checkedAt: string;
    key: string;
    status: number | null;
    contentType: string | null;
    cacheControl: string | null;
    cfCacheStatus: string | null;
    error: string | null;
  };
};
export type CatalogProduct = {
  sku: string;
  skus: string[];
  slug: string;
  name: string;
  dropiId: string | null;
  sources: string[];
};
export type CatalogDocument = {
  headers: string[];
  rows: string[][];
  slugs: string[];
  fotosIndex: number;
  products: CatalogProduct[];
};
export type PhotoManifest = {
  version: 1;
  policy: "p1";
  createdAt: string;
  updatedAt: string;
  products: CatalogProduct[];
  photos: Photo[];
  elapsedMs: number;
};

export class PipelineError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export function safeCode(error: unknown): string {
  return error instanceof PipelineError
    ? error.code
    : "LOCAL_IO_OR_DECODE_ERROR";
}

export function sourceAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      SOURCE_HOSTS.some((h) => h === url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export function sniffFormat(bytes: Uint8Array): ImageFormat | null {
  const starts = (signature: number[], offset = 0) =>
    signature.every((b, i) => bytes[offset + i] === b);
  if (starts([0xff, 0xd8, 0xff])) return "jpeg";
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return "png";
  if (
    bytes.length >= 12 &&
    starts([82, 73, 70, 70]) &&
    starts([87, 69, 66, 80], 8)
  )
    return "webp";
  if (starts([71, 73, 70, 56, 55, 97]) || starts([71, 73, 70, 56, 57, 97]))
    return "gif";
  return null;
}
export function assertByteCap(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_SOURCE_BYTES)
    throw new PipelineError("BYTE_CAP");
}
export function assertPixelCap(w: number, h: number): void {
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 1 ||
    h < 1 ||
    w > 99_999 ||
    h > 99_999 ||
    w * h > MAX_INPUT_PIXELS
  )
    throw new PipelineError("PIXEL_CAP");
}
export function retryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}
export function retryDelay(retry: number): number | null {
  return RETRY_DELAYS[retry] ?? null;
}
export function imageFlags(
  w: number,
  h: number,
  pages: number,
  alpha: boolean
): PhotoFlag[] {
  return [
    ...(Math.max(w, h) < 480 ? ["small" as const] : []),
    ...(pages > 1 ? ["animated" as const] : []),
    ...(alpha ? ["alpha" as const] : []),
    ...(w !== h ? ["non-square" as const] : []),
  ];
}
export function buildImagePlan(
  slug: string,
  sha256: string,
  w: number,
  h: number
) {
  assertPixelCap(w, h);
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !/^[0-9a-f]{64}$/.test(sha256)
  )
    throw new PipelineError("INVALID_IMAGE_IDENTITY");
  const base = `${slug.slice(0, 80).replace(/-+$/, "")}-${sha256.slice(0, 10)}`;
  const ref = formatRef(base, w, h);
  if (!ref) throw new PipelineError("INVALID_IMAGE_REF");
  return {
    ref,
    objects: [
      ...boxesFor(w, h).map((box) => ({
        key: keyFor(base, box)!,
        format: "webp" as const,
        ...sizeForBox(w, h, box)!,
        box,
      })),
      {
        key: jpegKeyFor(base)!,
        format: "jpeg" as const,
        ...jpegSizeFor(w, h)!,
        box: Math.min(1200, Math.max(w, h)),
      },
    ],
  };
}

const headerName = (value: string) => slugify(value.replace(/\(.*?\)/g, ""));
/** Preserve every column/value; group variant rows before filtering or replacing Fotos. */
export function readCatalog(
  text: string,
  onlySkus: readonly string[] = []
): CatalogDocument {
  const [headers, ...rows] = parseCsv(text);
  if (!headers?.length) throw new PipelineError("CSV_EMPTY");
  const names = headers.map(headerName);
  const find = (...options: string[]) =>
    names.findIndex((name) => options.includes(name));
  const skuIndex = find("sku"),
    nameIndex = find("producto", "nombre");
  const fotosIndex = find("fotos", "imagenes", "imagen", "foto");
  const slugIndex = find("slug"),
    idIndex = find("dropi-id");
  if ([skuIndex, nameIndex, fotosIndex].some((n) => n < 0))
    throw new PipelineError("CSV_COLUMNS");
  const products = new Map<string, CatalogProduct>();
  const slugs = rows.map((row) => {
    if (row.length !== headers.length) throw new PipelineError("CSV_ROW_WIDTH");
    const sku = row[skuIndex]!.trim(),
      name = row[nameIndex]!.trim();
    const slug = row[slugIndex]?.trim() || slugify(name);
    if (!sku || !name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      throw new PipelineError("CSV_PRODUCT");
    let product = products.get(slug);
    if (!product) {
      const id =
        row[idIndex]?.trim() || /^DROPI-([1-9]\d*)$/.exec(sku)?.[1] || null;
      product = { sku, skus: [], slug, name, dropiId: id, sources: [] };
      products.set(slug, product);
    } else if (product.name !== name)
      throw new PipelineError("CSV_SLUG_CONFLICT");
    if (!product.skus.includes(sku)) product.skus.push(sku);
    for (const source of row[fotosIndex]!.split(/[|\s]+/).filter(Boolean))
      if (!product.sources.includes(source)) product.sources.push(source);
    return slug;
  });
  if (
    onlySkus.some(
      (sku) => ![...products.values()].some((p) => p.skus.includes(sku))
    )
  )
    throw new PipelineError("SKU_NOT_FOUND");
  const selected = [...products.values()].filter(
    (p) => !onlySkus.length || p.skus.some((sku) => onlySkus.includes(sku))
  );
  const selectedSlugs = new Set(selected.map((p) => p.slug));
  return {
    headers,
    rows: rows.filter((_, i) => selectedSlugs.has(slugs[i]!)),
    slugs: slugs.filter((slug) => selectedSlugs.has(slug)),
    fotosIndex,
    products: selected,
  };
}
export function refsForProduct(
  photos: readonly Photo[],
  slug: string
): string[] {
  return [
    ...new Set(
      photos
        .filter((p) => p.slug === slug && p.status === "ok" && p.ref)
        .sort((a, b) => a.position - b.position)
        .map((p) => p.ref!)
    ),
  ];
}
export function rewriteImportCsv(
  document: CatalogDocument,
  photos: readonly Photo[]
): string {
  const written = new Set<string>();
  const rows: string[][] = [];
  document.rows.forEach((row, index) => {
    const slug = document.slugs[index]!;
    const refs = refsForProduct(photos, slug);
    if (!refs.length) return;
    const copy = [...row];
    copy[document.fotosIndex] = written.has(slug) ? "" : refs.join("|");
    written.add(slug);
    rows.push(copy);
  });
  return toCsv(document.headers, rows);
}
export function reportRows(
  products: readonly CatalogProduct[],
  photos: readonly Photo[]
) {
  return products.map((product) => {
    const group = photos.filter((p) => p.slug === product.slug);
    const successful = group.filter((p) => p.status === "ok").length;
    return {
      sku: product.sku,
      slug: product.slug,
      status:
        successful === 0
          ? "sin_fotos"
          : successful < product.sources.length
            ? "partial"
            : "ok",
      successful,
      failed: group.filter((p) => p.status === "failed").length,
      flags: [...new Set(group.flatMap((p) => p.flags))].join("|"),
      errors: [...new Set(group.map((p) => p.error).filter(Boolean))].join("|"),
    };
  });
}
export function uniqueObjects(photos: readonly Photo[]): PhotoObject[] {
  const objects = new Map<string, PhotoObject>();
  for (const photo of photos.filter((p) => p.status === "ok"))
    for (const object of photo.objects) {
      const old = objects.get(object.key);
      if (
        old &&
        ["format", "width", "height", "bytes", "sha256"].some(
          (k) => old[k as keyof PhotoObject] !== object[k as keyof PhotoObject]
        )
      )
        throw new PipelineError("OBJECT_CONFLICT");
      if (!old || object.uploadStatus === "uploaded")
        objects.set(object.key, object);
    }
  return [...objects.values()];
}
export function manifestTotals(manifest: PhotoManifest) {
  const objects = uniqueObjects(manifest.photos);
  return {
    products: manifest.products.length,
    photos: manifest.photos.length,
    successfulPhotos: manifest.photos.filter((p) => p.status === "ok").length,
    objects: objects.length,
    bytes: objects.reduce((total, obj) => total + obj.bytes, 0),
    pendingObjects: objects.filter((obj) => obj.uploadStatus !== "uploaded")
      .length,
    uploadedObjects: objects.filter((obj) => obj.uploadStatus === "uploaded")
      .length,
    flaggedPhotos: manifest.photos.filter((p) => p.flags.length > 0).length,
    failedPhotos: manifest.photos.filter((p) => p.status === "failed").length,
    elapsedMs: Math.round(manifest.elapsedMs),
  };
}
/** Keep the local derivation/upload history when preparing a SKU subset. */
export function mergeManifestScope(
  previous: PhotoManifest | null,
  products: CatalogProduct[]
) {
  const selected = new Set(products.map((p) => p.slug));
  return {
    products: [
      ...(previous?.products ?? []).filter((p) => !selected.has(p.slug)),
      ...products,
    ],
    photos: (previous?.photos ?? []).filter((p) => !selected.has(p.slug)),
  };
}
/** Validate an operator manifest before any object request or database mutation. */
export function parseManifest(value: unknown): PhotoManifest {
  const fail = () => {
    throw new PipelineError("MANIFEST_INVALID");
  };
  if (!value || typeof value !== "object") return fail();
  const m = value as PhotoManifest;
  const fields = (object: object, allowed: readonly string[]) =>
    Object.keys(object).every((key) => allowed.includes(key));
  const isoDate = (date: unknown) =>
    typeof date === "string" && Number.isFinite(Date.parse(date));
  const nullableText = (text: unknown) =>
    text === null || typeof text === "string";
  const nullableCount = (count: unknown) =>
    count === null ||
    (typeof count === "number" && Number.isSafeInteger(count) && count >= 0);
  const httpStatus = (status: unknown) =>
    status === null ||
    (typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599);
  const code = (value: unknown) =>
    value === null ||
    (typeof value === "string" && /^[A-Z0-9_]{1,80}$/.test(value));
  if (
    !fields(m, [
      "version",
      "policy",
      "createdAt",
      "updatedAt",
      "products",
      "photos",
      "elapsedMs",
    ]) ||
    !isoDate(m.createdAt) ||
    !isoDate(m.updatedAt) ||
    m.version !== 1 ||
    m.policy !== "p1" ||
    !Array.isArray(m.products) ||
    !Array.isArray(m.photos) ||
    !Number.isFinite(m.elapsedMs) ||
    m.elapsedMs < 0
  )
    return fail();
  for (const p of m.products) {
    if (
      !p ||
      !fields(p, ["sku", "skus", "slug", "name", "dropiId", "sources"]) ||
      typeof p.sku !== "string" ||
      typeof p.name !== "string" ||
      !nullableText(p.dropiId) ||
      typeof p.slug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) ||
      !Array.isArray(p.skus) ||
      !p.skus.every((s) => typeof s === "string") ||
      !Array.isArray(p.sources) ||
      !p.sources.every(
        (s) => typeof s === "string" && (s === "" || sourceAllowed(s))
      )
    )
      return fail();
  }
  for (const p of m.photos) {
    if (
      !p ||
      !fields(p, [
        "dropiId",
        "sku",
        "slug",
        "name",
        "position",
        "sourceUrl",
        "status",
        "httpStatus",
        "bytes",
        "sha256",
        "format",
        "width",
        "height",
        "pages",
        "alphaUsed",
        "flags",
        "ref",
        "original",
        "objects",
        "timings",
        "error",
        "verification",
      ]) ||
      !m.products.some((product) => product.slug === p.slug) ||
      typeof p.sku !== "string" ||
      typeof p.name !== "string" ||
      !nullableText(p.dropiId) ||
      !httpStatus(p.httpStatus) ||
      ![p.width, p.height, p.pages].every(nullableCount) ||
      typeof p.sourceUrl !== "string" ||
      (p.sourceUrl !== "" && !sourceAllowed(p.sourceUrl)) ||
      typeof p.alphaUsed !== "boolean" ||
      !code(p.error) ||
      !p.timings ||
      !fields(p.timings, ["downloadMs", "encodeMs", "totalMs"]) ||
      ![p.timings.downloadMs, p.timings.encodeMs, p.timings.totalMs].every(
        (n) => Number.isFinite(n) && n >= 0
      ) ||
      !Number.isInteger(p.position) ||
      p.position < 0 ||
      !Array.isArray(p.flags) ||
      !p.flags.every((f) =>
        ["small", "animated", "alpha", "non-square"].includes(f)
      ) ||
      !Array.isArray(p.objects)
    )
      return fail();
    assertByteCap(p.bytes);
    // Failed photos are retained for review too: their archived paths must
    // have the same closed set of extensions as successful photos.
    if (p.format !== null && !["jpeg", "png", "webp", "gif"].includes(p.format))
      return fail();
    if (
      p.original !== null &&
      (!p.sha256 ||
        !p.format ||
        p.original !== `originals/${p.sha256}.${p.format}`)
    )
      return fail();
    if (
      p.sha256 !== null &&
      (typeof p.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.sha256))
    )
      return fail();
    if (
      p.verification &&
      (!fields(p.verification, [
        "checkedAt",
        "key",
        "status",
        "contentType",
        "cacheControl",
        "cfCacheStatus",
        "error",
      ]) ||
        !isoDate(p.verification.checkedAt) ||
        !httpStatus(p.verification.status) ||
        ![
          p.verification.contentType,
          p.verification.cacheControl,
          p.verification.cfCacheStatus,
        ].every(nullableText) ||
        !code(p.verification.error) ||
        !p.objects.some((o) => o.key === p.verification!.key))
    )
      return fail();
    if (p.status === "failed") {
      if (p.objects.length || p.ref !== null) return fail();
      continue;
    }
    if (
      p.status !== "ok" ||
      !sourceAllowed(p.sourceUrl) ||
      !p.sha256 ||
      !/^[0-9a-f]{64}$/.test(p.sha256) ||
      !p.ref ||
      !p.width ||
      !p.height ||
      !Number.isInteger(p.pages) ||
      p.pages! < 1 ||
      !["jpeg", "png", "webp", "gif"].includes(p.format ?? "") ||
      !p.original ||
      !/^(originals\/[0-9a-f]{64}\.(jpeg|png|webp|gif))$/.test(p.original)
    )
      return fail();
    const ref = parseRef(p.ref);
    if (!ref || ref.width !== p.width || ref.height !== p.height) return fail();
    assertPixelCap(p.width, p.height);
    const expected = buildImagePlan(
      ref.base.slice(0, -11),
      p.sha256,
      p.width,
      p.height
    );
    if (expected.ref !== p.ref || expected.objects.length !== p.objects.length)
      return fail();
    for (const [index, object] of p.objects.entries()) {
      const want = expected.objects[index]!;
      if (
        !object ||
        !fields(object, [
          "key",
          "format",
          "width",
          "height",
          "bytes",
          "sha256",
          "uploadStatus",
          "uploadedAt",
          "uploadHttpStatus",
          "uploadError",
        ]) ||
        (object.uploadError !== undefined && !code(object.uploadError)) ||
        (object.uploadedAt !== undefined && !isoDate(object.uploadedAt)) ||
        (object.uploadHttpStatus !== undefined &&
          !httpStatus(object.uploadHttpStatus)) ||
        object.key !== want.key ||
        object.format !== want.format ||
        object.width !== want.width ||
        object.height !== want.height ||
        !Number.isSafeInteger(object.bytes) ||
        object.bytes <= 0 ||
        typeof object.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(object.sha256) ||
        !["pending", "uploaded", "failed"].includes(object.uploadStatus)
      )
        return fail();
    }
  }
  uniqueObjects(m.photos);
  return m;
}
export function repairItems(manifest: PhotoManifest, slug: string) {
  const product = manifest.products.find((p) => p.slug === slug);
  if (!product) throw new PipelineError("PRODUCT_NOT_IN_MANIFEST");
  const refs = refsForProduct(manifest.photos, slug);
  if (!refs.length) throw new PipelineError("NO_READY_PHOTOS");
  const photos = manifest.photos.filter(
    (p) => p.slug === slug && p.status === "ok"
  );
  if (photos.some((p) => p.objects.some((o) => o.uploadStatus !== "uploaded")))
    throw new PipelineError("OBJECTS_NOT_UPLOADED");
  return refs.map((ref, index) => ({
    ref,
    alt: index === 0 ? product.name : `${product.name} — foto ${index + 1}`,
  }));
}
export function htmlEscape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
}
export function parseOptions(
  args: readonly string[],
  values: readonly string[],
  flags: readonly string[] = []
) {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (options.has(arg) || (!values.includes(arg) && !flags.includes(arg)))
      throw new PipelineError("CLI_OPTIONS");
    if (flags.includes(arg)) options.set(arg, "true");
    else {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new PipelineError("CLI_OPTIONS");
      options.set(arg, value);
    }
  }
  for (const name of values.filter((name) => name !== "--solo"))
    if (!options.has(name)) throw new PipelineError("CLI_REQUIRED_OPTIONS");
  return options;
}
