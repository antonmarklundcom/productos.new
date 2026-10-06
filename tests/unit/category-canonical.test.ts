import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/db/queries", () => ({
  getCategoryBySlug: async () => ({
    slug: "rings",
    name: "Rings",
    description: null,
  }),
  getCategories: async () => [],
  getBrands: async () => [],
  getCategoryProducts: vi.fn(),
  isCatalogSort: vi.fn(),
}));
import { generateMetadata } from "@/app/categoria/[slug]/page";
describe("category pagination canonicals", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    [{}, "https://store.example.test/categoria/rings", undefined],
    [
      { page: "2" },
      "https://store.example.test/categoria/rings?page=2",
      undefined,
    ],
    [{ page: "2x" }, "https://store.example.test/categoria/rings", undefined],
    [
      { page: "2", precio: "1-100" },
      "https://store.example.test/categoria/rings",
      { index: false, follow: true },
    ],
  ] as const)(
    "canonical and indexing for %j",
    async (query, canonical, robots) => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://store.example.test");
      const metadata = await generateMetadata({
        params: Promise.resolve({ slug: "rings" }),
        searchParams: Promise.resolve(query),
      });
      expect(metadata.alternates?.canonical).toBe(canonical);
      expect(metadata.robots).toEqual(robots);
    }
  );
});
