import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AwsClient } from "aws4fetch";
import { publicBase } from "../src/lib/imagenes-r2";
import {
  manifestTotals,
  parseManifest,
  parseOptions,
  PipelineError,
  retryDelay,
  retryableStatus,
  safeCode,
  uniqueObjects,
  type PhotoManifest,
} from "./fotos-lib";

async function checkpoint(
  file: string,
  manifest: PhotoManifest
): Promise<void> {
  manifest.updatedAt = new Date().toISOString();
  await fs.writeFile(`${file}.tmp`, JSON.stringify(manifest, null, 2) + "\n");
  await fs.rename(`${file}.tmp`, file);
}
function uploadConfig() {
  const required = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ] as const;
  for (const name of required)
    if (!process.env[name]?.trim()) throw new PipelineError(`MISSING_${name}`);
  const account = process.env.R2_ACCOUNT_ID!.trim();
  const bucket = process.env.R2_BUCKET!.trim();
  if (!/^[a-f0-9]{32}$/.test(account))
    throw new PipelineError("INVALID_R2_ACCOUNT_ID");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))
    throw new PipelineError("INVALID_R2_BUCKET");
  return {
    endpoint: `https://${account}.r2.cloudflarestorage.com/${bucket}`,
    client: new AwsClient({
      accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
      service: "s3",
      region: "auto",
      retries: 0,
    }),
  };
}
async function put(
  client: AwsClient,
  url: string,
  bytes: Buffer,
  format: "webp" | "jpeg"
): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    let retry = false;
    try {
      const request = await client.sign(url, {
        method: "PUT",
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": format === "webp" ? "image/webp" : "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
          // Immutable keys: refuse to overwrite an object not recorded by this manifest.
          "If-None-Match": "*",
        },
      });
      const response = await fetch(request, { redirect: "error" });
      await response.body?.cancel();
      if (response.ok) return response.status;
      retry = retryableStatus(response.status);
      throw new PipelineError(`HTTP_${response.status}`);
    } catch (error) {
      retry ||= !(error instanceof PipelineError);
      const wait = retryDelay(attempt);
      if (!retry || wait === null)
        throw error instanceof PipelineError
          ? error
          : new PipelineError("UPLOAD_NETWORK");
      await delay(wait);
    }
  }
}
async function main(): Promise<void> {
  const args = parseOptions(
    process.argv.slice(2),
    ["--manifiesto"],
    ["--aplicar", "--verificar"]
  );
  const file = path.resolve(args.get("--manifiesto")!);
  const manifest = parseManifest(JSON.parse(await fs.readFile(file, "utf8")));
  const apply = args.has("--aplicar"),
    verify = args.has("--verificar");
  const base = verify ? publicBase() : null;
  if (verify && !base)
    throw new PipelineError("MISSING_OR_INVALID_NEXT_PUBLIC_IMAGENES_URL");
  // A dry run never reads credentials, opens SQL, fetches or edits the manifest.
  if (!apply && !verify) {
    console.log(JSON.stringify(manifestTotals(manifest)));
    return;
  }
  let failures = 0;
  if (apply) {
    const config = uploadConfig();
    for (const object of uniqueObjects(manifest.photos)) {
      if (object.uploadStatus === "uploaded") {
        // One immutable key may be shared by several products: keep proofs consistent.
        for (const photo of manifest.photos)
          for (const stored of photo.objects)
            if (stored.key === object.key) Object.assign(stored, object);
        await checkpoint(file, manifest);
        continue;
      }
      let status: number | null = null,
        errorCode: string | null = null;
      try {
        const bytes = await fs.readFile(
          path.join(path.dirname(file), object.key)
        );
        if (
          bytes.length !== object.bytes ||
          createHash("sha256").update(bytes).digest("hex") !== object.sha256
        )
          throw new PipelineError("LOCAL_OBJECT_CHANGED");
        status = await put(
          config.client,
          `${config.endpoint}/${object.key}`,
          bytes,
          object.format
        );
      } catch (error) {
        errorCode = safeCode(error);
        failures++;
      }
      const http = errorCode && /^HTTP_(\d{3})$/.exec(errorCode);
      for (const photo of manifest.photos)
        for (const stored of photo.objects)
          if (stored.key === object.key) {
            stored.uploadStatus = errorCode ? "failed" : "uploaded";
            stored.uploadHttpStatus =
              status ?? (http ? Number(http[1]) : undefined);
            stored.uploadError = errorCode ?? undefined;
            stored.uploadedAt = errorCode
              ? undefined
              : new Date().toISOString();
          }
      await checkpoint(file, manifest);
    }
  }
  if (verify) {
    const checked = new Map<
      string,
      NonNullable<PhotoManifest["photos"][number]["verification"]>
    >();
    for (const photo of manifest.photos.filter((p) => p.status === "ok")) {
      const webps = photo.objects.filter((o) => o.format === "webp");
      const object =
        webps.find((o) => /-480\.webp$/.test(o.key)) ?? webps.at(-1)!;
      let result = checked.get(object.key);
      if (!result) {
        result = {
          checkedAt: new Date().toISOString(),
          key: object.key,
          status: null,
          contentType: null,
          cacheControl: null,
          cfCacheStatus: null,
          error: null,
        };
        try {
          const response = await fetch(`${base}/${object.key}`, {
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
          });
          result.status = response.status;
          result.contentType = response.headers.get("content-type");
          result.cacheControl = response.headers.get("cache-control");
          result.cfCacheStatus = response.headers.get("cf-cache-status");
          await response.body?.cancel();
          if (!response.ok) {
            result.error = `HTTP_${response.status}`;
            failures++;
          }
        } catch {
          result.error = "VERIFY_NETWORK";
          failures++;
        }
        checked.set(object.key, result);
      }
      photo.verification = result;
      await checkpoint(file, manifest);
    }
  }
  console.log(JSON.stringify({ ...manifestTotals(manifest), failures }));
  if (failures) process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(safeCode(error));
  process.exitCode = 1;
});
