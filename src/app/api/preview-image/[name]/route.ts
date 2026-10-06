import { readFile } from "node:fs/promises";
import path from "node:path";
import { isLocalCatalogPreview } from "@/config/preview";

export const dynamic = "force-dynamic";
const ALLOWED = new Set(["auriculares", "auriculares-lifestyle"]);
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!isLocalCatalogPreview() || !ALLOWED.has(name))
    return new Response(null, { status: 404 });
  const artwork = await readFile(
    path.join(process.cwd(), "preview-assets", `${name}.webp`)
  );
  return new Response(new Uint8Array(artwork), {
    headers: {
      "content-type": "image/webp",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
