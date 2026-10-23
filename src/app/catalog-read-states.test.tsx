import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const readers = vi.hoisted(() => ({ category: vi.fn(), search: vi.fn() }));
vi.mock("@/db/queries", () => ({
 getCategoryBySlug: async () => ({ id: 1, slug: "tools", name: "Tools", description: null, imageCloudinaryId: null }),
 getCategoryProducts: readers.category, searchProductsPage: readers.search,
 getCategories: async () => [], getBrands: async () => [], isCatalogSort: () => false,
}));
vi.mock("@/domain/store-settings", () => ({ getStoreSettings: async () => ({ vidriera: {} }) }));
vi.mock("@/components/catalog-filters", () => ({ CatalogFilters: () => null }));
vi.mock("@/components/product-card", () => ({ ProductCard: ({ product }: {product: {name: string}}) => <h3>{product.name}</h3> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
import CategoryPage from "./categoria/[slug]/page";
import SearchPage from "./buscar/page";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const categoryProps = (query: Record<string, string> = {}) => ({ params: Promise.resolve({slug: "tools"}), searchParams: Promise.resolve(query) });
it("renders a retryable outage separately from a genuinely empty category", async () => {
 const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
 readers.category.mockRejectedValueOnce(new Error("SECRET SQL synthetic"));
 const outage = render(await CategoryPage(categoryProps({page: "999", marca: "A"})));
 expect(screen.getByRole("status")).toHaveTextContent("temporalmente");
 expect(screen.getByRole("link", {name: "Reintentar"})).toHaveAttribute("href", "?marca=A&page=999");
 expect(outage.container.textContent).not.toContain("SECRET SQL");
 expect(diagnostic).toHaveBeenCalledWith("CATEGORY_PRODUCTS_UNAVAILABLE");
 outage.unmount();
 readers.category.mockResolvedValueOnce({products: [], total: 0, page: 1, perPage: 12, totalPages: 1});
 render(await CategoryPage(categoryProps()));
 expect(screen.queryByRole("status")).toBeNull();
 expect(screen.queryByRole("link", {name: "Reintentar"})).toBeNull();
});
it("rejects impossible render pages with the same filtered boundary as metadata", async () => {
 readers.category.mockResolvedValueOnce({products: [], total: 1, page: 2, perPage: 12, totalPages: 1});
 await expect(CategoryPage(categoryProps({page: "2", marca: "A"}))).rejects.toThrow("NOT_FOUND");
});
it("renders total results, a results H2 and reachable continuation", async () => {
 readers.search.mockResolvedValueOnce({products: [{id: 1, name: "Cable"}], total: 41, page: 1, totalPages: 2});
 render(await SearchPage({searchParams: Promise.resolve({q: "cable"})}));
 expect(screen.getByRole("heading", {level: 2})).toBeInTheDocument();
 expect(screen.getByRole("heading", {level: 3})).toHaveTextContent("Cable");
 expect(screen.getByText(/41 productos/)).toBeInTheDocument();
 expect(screen.getByRole("link", {name: /siguiente/i})).toHaveAttribute("href", "/buscar?q=cable&page=2");
});

it.each([
  { page: "999", total: 41, totalPages: 2 },
  { page: "2", total: 0, totalPages: 1 },
])("rejects impossible search render pages %j", async ({page, total, totalPages}) => {
  readers.search.mockResolvedValueOnce({ products: [], total, page: Number(page), totalPages });
  await expect(SearchPage({ searchParams: Promise.resolve({q: "cable", page}) })).rejects.toThrow("NOT_FOUND");
});
it("keeps the final valid search page reachable", async () => {
  readers.search.mockResolvedValueOnce({ products: [{id: 41, name: "Cable 41"}], total: 41, page: 2, totalPages: 2 });
  render(await SearchPage({ searchParams: Promise.resolve({q: "cable", page: "2"}) }));
  expect(screen.getByRole("heading", {level: 3})).toHaveTextContent("Cable 41");
  expect(screen.getByRole("link", {name: /anterior/i})).toHaveAttribute("href", "/buscar?q=cable&page=1");
  expect(screen.queryByRole("link", {name: /siguiente/i})).toBeNull();
});

it("keeps a search outage available on a high page", async () => {
  readers.search.mockRejectedValueOnce(new Error("SECRET SQL synthetic"));
  const outage = render(await SearchPage({ searchParams: Promise.resolve({q: "cable", page: "999"}) }));
  expect(screen.getByText("El catálogo todavía no está disponible.")).toBeInTheDocument();
  expect(outage.container.textContent).not.toContain("SECRET SQL");
});
it("skips the catalog read for short queries even on a high page", async () => {
  readers.search.mockClear();
  const props = { searchParams: Promise.resolve({q: " a ", page: "999"}) };
  render(await SearchPage(props));
  expect(readers.search).not.toHaveBeenCalled();
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.queryByText("El catálogo todavía no está disponible.")).toBeNull();
});
it("parses the first query values and preserves the encoded search in continuation links", async () => {
  readers.search.mockResolvedValueOnce({ products: [{id: 1, name: "Cable"}], total: 41, page: 1, totalPages: 2 });
  render(await SearchPage({ searchParams: Promise.resolve({q: [" cable & usb ", "ignored"], page: ["invalid", "999"]}) }));
  expect(readers.search).toHaveBeenLastCalledWith("cable & usb", {page: 1});
  expect(screen.getByRole("link", {name: /siguiente/i})).toHaveAttribute("href", "/buscar?q=cable%20%26%20usb&page=2");
});
