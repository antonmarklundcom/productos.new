import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalCatalogPreview } from "@/config/preview";
import { GET } from "@/app/api/preview-image/[name]/route";

describe("local catalog isolation", () => {
  afterEach(() => vi.unstubAllEnvs());
  function local() {
    vi.stubEnv("LOCAL_CATALOG_PREVIEW", "1");
    vi.stubEnv(
      "DATABASE_URL",
      "mysql://root@127.0.0.1:3309/store_preview_test"
    );
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3100");
  }
  it("requires opt-in, a loopback database, a loopback site, and the disposable preview suffix", () => {
    local();
    expect(isLocalCatalogPreview()).toBe(true);
    vi.stubEnv("LOCAL_CATALOG_PREVIEW", "");
    expect(isLocalCatalogPreview()).toBe(false);
    local();
    vi.stubEnv(
      "DATABASE_URL",
      "mysql://root@db.example.test/store_preview_test"
    );
    expect(isLocalCatalogPreview()).toBe(false);
    local();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://store.example.test");
    expect(isLocalCatalogPreview()).toBe(false);
    local();
    vi.stubEnv("DATABASE_URL", "mysql://root@127.0.0.1/store_live");
    expect(isLocalCatalogPreview()).toBe(false);
  });
  it("serves only allowlisted local artwork and returns 404 outside the isolated preview", async () => {
    local();
    const request = new Request(
      "http://127.0.0.1/api/preview-image/auriculares"
    );
    const image = await GET(request, {
      params: Promise.resolve({ name: "auriculares" }),
    });
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
    const bytes = new Uint8Array(await image.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(
      (
        await GET(request, {
          params: Promise.resolve({ name: "../organizador" }),
        })
      ).status
    ).toBe(404);
    vi.stubEnv("LOCAL_CATALOG_PREVIEW", "");
    expect(
      (await GET(request, { params: Promise.resolve({ name: "auriculares" }) }))
        .status
    ).toBe(404);
  });
});
