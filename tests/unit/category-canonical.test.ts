import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/db/queries", () => ({
  getCategoryBySlug: async () => ({
    slug: "rings",
    name: "Rings",
    description: null,
  }),
  getCategories: async () => [],
  getBrands: async () => [],
  getCategoryProducts: vi.fn(async () => ({ products: [], total: 24, page: 1, perPage: 12, totalPages: 2 })),
  isCatalogSort: vi.fn(),
}));
import { getCategoryProducts } from "@/db/queries";
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

it.each([{ page: "3" }, { page: "999" }, { page: "2", marca: "few" }])("rejects impossible category metadata %j", async (query) => {
  vi.mocked(getCategoryProducts).mockResolvedValueOnce({ products: [], total: 1, page: Number(query.page), perPage: 12, totalPages: 1 });
  await expect(generateMetadata({ params: Promise.resolve({ slug: "rings" }), searchParams: Promise.resolve(query) })).rejects.toThrow();
});
it("marks a failed category reader unavailable for indexing", async () => {
  vi.mocked(getCategoryProducts).mockRejectedValueOnce(new Error("private synthetic database detail"));
  const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
  const metadata = await generateMetadata({ params: Promise.resolve({ slug: "rings" }), searchParams: Promise.resolve({page: "999"}) });
  expect(metadata.robots).toEqual({ index: false, follow: true });
  expect(diagnostic).toHaveBeenCalledWith("CATEGORY_PRODUCTS_UNAVAILABLE");
  diagnostic.mockRestore();
});
