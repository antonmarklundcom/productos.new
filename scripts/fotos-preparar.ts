import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { P1_JPEG, P1_WEBP } from "../src/lib/imagenes-r2";
import { toCsv } from "../src/lib/csv";
import {
  assertByteCap,
  assertPixelCap,
  buildImagePlan,
  htmlEscape,
  imageFlags,
  manifestTotals,
  mergeManifestScope,
  MAX_INPUT_PIXELS,
  parseManifest,
  parseOptions,
  PipelineError,
  readCatalog,
  reportRows,
  retryDelay,
  retryableStatus,
  rewriteImportCsv,
  safeCode,
  sniffFormat,
  sourceAllowed,
  type Photo,
  type PhotoManifest,
} from "./fotos-lib";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};

async function outputOutsideRepo(requested: string): Promise<string> {
  const repo = await fs.realpath(path.resolve(import.meta.dirname, ".."));
  let ancestor = path.resolve(requested);
  const tail: string[] = [];
  while (true) {
    try {
      ancestor = await fs.realpath(ancestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      tail.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
  const target = path.resolve(ancestor, ...tail);
  if (within(repo, target))
    throw new PipelineError("OUTPUT_MUST_BE_OUTSIDE_REPO");
  await fs.mkdir(target, { recursive: true });
  const actual = await fs.realpath(target);
  if (within(repo, actual))
    throw new PipelineError("OUTPUT_MUST_BE_OUTSIDE_REPO");
  return actual;
}

async function download(
  url: string
): Promise<{ bytes: Buffer; status: number }> {
  if (!sourceAllowed(url)) throw new PipelineError("SOURCE_URL_NOT_ALLOWED");
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let retry = false;
    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        retry = retryableStatus(response.status);
        throw new PipelineError(`HTTP_${response.status}`);
      }
      const length = response.headers.get("content-length");
      if (length !== null) assertByteCap(Number(length));
      if (!response.body) throw new PipelineError("EMPTY_BODY");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          assertByteCap(bytes);
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      return { bytes: Buffer.concat(chunks, bytes), status: response.status };
    } catch (error) {
      controller.abort();
      retry ||= !(error instanceof PipelineError);
      const wait = retryDelay(attempt);
      if (!retry || wait === null)
        throw error instanceof PipelineError
          ? error
          : new PipelineError("DOWNLOAD_NETWORK");
      clearTimeout(timer);
      await delay(wait);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function immutableWrite(file: string, bytes: Buffer): Promise<void> {
  try {
    await fs.writeFile(file, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (hash(await fs.readFile(file)) !== hash(bytes))
      throw new PipelineError("LOCAL_OBJECT_COLLISION");
  }
}

async function cachedPhotoReady(
  photo: Photo,
  output: string
): Promise<boolean> {
  try {
    if (photo.status !== "ok" || !photo.original) return false;
    const original = await fs.readFile(path.join(output, photo.original));
    if (original.length !== photo.bytes || hash(original) !== photo.sha256)
      return false;
    for (const object of photo.objects) {
      const bytes = await fs.readFile(path.join(output, object.key));
      if (bytes.length !== object.bytes || hash(bytes) !== object.sha256)
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

function reviewHtml(photos: readonly Photo[]): string {
  const rows = photos
    .map((photo) => {
      const img = (key: string | null | undefined, cls: string) =>
        key
          ? `<img class="${cls}" loading="lazy" src="${htmlEscape(key)}" alt="${htmlEscape(photo.name)}">`
          : "<span>Sin foto</span>";
      const webps = photo.objects.filter((o) => o.format === "webp");
      const card = webps.find((o) => /-480\.webp$/.test(o.key)) ?? webps.at(-1);
      const detail = webps.at(-1);
      const numbers = photo.objects
        .map((o) => `${o.width}×${o.height}: ${o.bytes} bytes`)
        .join("; ");
      return `<tr><td><strong>${htmlEscape(photo.name)}</strong><br>${htmlEscape(photo.sku)}<br>
      ${photo.width ?? 0}×${photo.height ?? 0}; ${photo.bytes} bytes; ${photo.pages ?? 0} frames<br>
      ${htmlEscape(photo.flags.join(", "))}<br>${htmlEscape(photo.error ?? "ok")}<br>
      ${htmlEscape(numbers)}<br>download ${Math.round(photo.timings.downloadMs)} ms; encode ${Math.round(photo.timings.encodeMs)} ms</td>
      <td>${img(photo.original, "source")}</td><td>${img(card?.key, "card")}</td><td>${img(detail?.key, "detail")}</td></tr>`;
    })
    .join("\n");
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Revisión local p1</title><style>body{font:14px system-ui;margin:20px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:12px;vertical-align:top}img{object-fit:contain;background:#f3f4f6}.source{max-width:none}.card{width:180px;height:180px}.detail{width:600px;height:600px}@media(max-width:700px){tr{display:grid;grid-template-columns:1fr}td{overflow:auto}.detail{width:100%;height:auto;max-height:600px}}</style>
    <h1>Revisión local p1</h1><p>Original archivado a 1×; tarjeta 180 px; detalle 600 px. Sin recortes ni ampliación de archivos.</p>
    <table><thead><tr><th>Datos</th><th>Original</th><th>Tarjeta</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table></html>`;
}

async function main(): Promise<void> {
  const args = parseOptions(process.argv.slice(2), [
    "--csv",
    "--salida",
    "--solo",
  ]);
  const output = await outputOutsideRepo(args.get("--salida")!);
  const document = readCatalog(
    await fs.readFile(path.resolve(args.get("--csv")!), "utf8"),
    args
      .get("--solo")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const manifestFile = path.join(output, "manifest.private.json");
  let previous: PhotoManifest | null = null;
  try {
    previous = parseManifest(
      JSON.parse(await fs.readFile(manifestFile, "utf8"))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.join(output, "originals"), { recursive: true });
  await fs.mkdir(path.join(output, "p1"), { recursive: true });
  const cache = new Map<string, Photo>();
  const byUrl = new Map<string, Photo>();
  for (const photo of previous?.photos ?? [])
    if (await cachedPhotoReady(photo, output)) {
      cache.set(photo.sha256!, photo);
      byUrl.set(photo.sourceUrl, photo);
    }
  const started = performance.now();
  const now = new Date().toISOString();
  const scope = mergeManifestScope(
    previous,
    document.products.map((p) => ({
      ...p,
      sources: p.sources.map((s) => (sourceAllowed(s) ? s : "")),
    }))
  );
  const manifest: PhotoManifest = {
    version: 1,
    policy: "p1",
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    products: scope.products,
    photos: scope.photos,
    elapsedMs: 0,
  };
  for (const product of document.products)
    for (const [position, url] of product.sources.entries()) {
      const start = performance.now();
      let photo: Photo = {
        dropiId: product.dropiId,
        sku: product.sku,
        slug: product.slug,
        name: product.name,
        position,
        sourceUrl: sourceAllowed(url) ? url : "",
        status: "failed",
        httpStatus: null,
        bytes: 0,
        sha256: null,
        format: null,
        width: null,
        height: null,
        pages: null,
        alphaUsed: false,
        flags: [],
        ref: null,
        original: null,
        objects: [],
        timings: { downloadMs: 0, encodeMs: 0, totalMs: 0 },
        error: null,
      };
      try {
        const known = byUrl.get(url);
        if (known)
          photo = {
            ...known,
            dropiId: product.dropiId,
            sku: product.sku,
            slug: product.slug,
            name: product.name,
            position,
            timings: { downloadMs: 0, encodeMs: 0, totalMs: 0 },
            objects: known.objects.map((o) => ({ ...o })),
          };
        else {
          const fetched = await download(url);
          photo.timings.downloadMs = performance.now() - start;
          photo.httpStatus = fetched.status;
          photo.bytes = fetched.bytes.length;
          photo.format = sniffFormat(fetched.bytes);
          if (!photo.format) throw new PipelineError("MAGIC_BYTES");
          photo.sha256 = hash(fetched.bytes);
          const already = cache.get(photo.sha256);
          if (already)
            photo = {
              ...already,
              dropiId: product.dropiId,
              sku: product.sku,
              slug: product.slug,
              name: product.name,
              position,
              sourceUrl: url,
              timings: {
                downloadMs: photo.timings.downloadMs,
                encodeMs: 0,
                totalMs: 0,
              },
              objects: already.objects.map((o) => ({ ...o })),
            };
          else {
            const encodeStart = performance.now();
            const originalInput = () =>
              sharp(fetched.bytes, {
                limitInputPixels: MAX_INPUT_PIXELS,
                page: 0,
                pages: 1,
                failOn: "error",
              }).rotate();
            const metadata = await originalInput().metadata();
            const swapped = (metadata.orientation ?? 1) >= 5;
            photo.width = swapped ? metadata.height! : metadata.width!;
            photo.height = swapped ? metadata.width! : metadata.height!;
            assertPixelCap(photo.width, photo.height);
            photo.pages = metadata.pages ?? 1;
            photo.alphaUsed = metadata.hasAlpha ?? false;
            photo.flags = imageFlags(
              photo.width,
              photo.height,
              photo.pages,
              photo.alphaUsed
            );
            // Decode/orient frame 0 once. JPEG/WebP shrink-on-load can round a
            // dimension down; raw pixels preserve p1's Math.round dimensions.
            const decoded = await originalInput()
              .toColourspace("srgb")
              .raw()
              .toBuffer({ resolveWithObject: true });
            if (
              decoded.info.width !== photo.width ||
              decoded.info.height !== photo.height
            )
              throw new PipelineError("ORIENTED_DIMENSIONS");
            const input = () =>
              sharp(decoded.data, {
                raw: {
                  width: decoded.info.width,
                  height: decoded.info.height,
                  channels: decoded.info.channels,
                },
              });
            const plan = buildImagePlan(
              product.slug,
              photo.sha256,
              photo.width,
              photo.height
            );
            photo.original = `originals/${photo.sha256}.${photo.format}`;
            await immutableWrite(
              path.join(output, photo.original),
              fetched.bytes
            );
            for (const object of plan.objects) {
              const resized = input().resize(object.box, object.box, {
                fit: "inside",
                withoutEnlargement: true,
              });
              const encoded = await (
                object.format === "webp"
                  ? resized.webp(P1_WEBP)
                  : resized.flatten({ background: "#ffffff" }).jpeg(P1_JPEG)
              ).toBuffer({ resolveWithObject: true });
              if (
                encoded.info.width !== object.width ||
                encoded.info.height !== object.height
              )
                throw new PipelineError("ENCODE_DIMENSIONS");
              await immutableWrite(path.join(output, object.key), encoded.data);
              photo.objects.push({
                key: object.key,
                format: object.format,
                width: object.width,
                height: object.height,
                bytes: encoded.data.length,
                sha256: hash(encoded.data),
                uploadStatus: "pending",
              });
            }
            photo.ref = plan.ref;
            photo.status = "ok";
            photo.timings.encodeMs = performance.now() - encodeStart;
            cache.set(photo.sha256, photo);
          }
          byUrl.set(url, photo);
        }
      } catch (error) {
        photo.status = "failed";
        photo.ref = null;
        photo.objects = [];
        photo.error = safeCode(error);
        const http = /^HTTP_(\d{3})$/.exec(photo.error);
        if (http) photo.httpStatus = Number(http[1]);
      }
      photo.timings.totalMs = performance.now() - start;
      manifest.photos.push(photo);
    }
  manifest.elapsedMs = performance.now() - started;
  manifest.updatedAt = new Date().toISOString();
  parseManifest(manifest);
  await fs.writeFile(
    `${manifestFile}.tmp`,
    JSON.stringify(manifest, null, 2) + "\n"
  );
  await fs.rename(`${manifestFile}.tmp`, manifestFile);
  const reports = reportRows(manifest.products, manifest.photos);
  await fs.writeFile(
    path.join(output, "import-r2.csv"),
    rewriteImportCsv(document, manifest.photos)
  );
  await fs.writeFile(
    path.join(output, "report.csv"),
    toCsv(
      [
        "SKU",
        "Slug",
        "Estado",
        "Fotos listas",
        "Fotos fallidas",
        "Flags",
        "Errores",
      ],
      reports.map((r) => [
        r.sku,
        r.slug,
        r.status,
        r.successful,
        r.failed,
        r.flags,
        r.errors,
      ])
    )
  );
  await fs.writeFile(
    path.join(output, "review.html"),
    reviewHtml(manifest.photos)
  );
  console.log(JSON.stringify(manifestTotals(manifest)));
  if (
    manifest.photos.some((p) => p.status === "failed") ||
    reports.some((r) => r.status === "sin_fotos")
  )
    process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(safeCode(error));
  process.exitCode = 1;
});
