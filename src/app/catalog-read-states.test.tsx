import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const readers = vi.hoisted(() => ({ category: vi.fn(), search: vi.fn(), facets: vi.fn() }));
vi.mock("@/db/queries", () => ({
 getCategoryBySlug: async () => ({ id: 1, slug: "tools", name: "Tools", description: null, imageCloudinaryId: null }),
 getCategoryProducts: readers.category, searchProductsPage: readers.search,
 getSearchFacets: readers.facets, getCategories: async () => [], getBrands: async () => [], isCatalogSort: () => false,
}));
vi.mock("@/domain/store-settings", () => ({ getStoreSettings: async () => ({ vidriera: {} }) }));
vi.mock("@/components/catalog-filters", () => ({ CatalogFilters: () => null }));
vi.mock("@/components/product-card", () => ({ ProductCard: ({ product }: {product: {name: string}}) => <h3>{product.name}</h3> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
import CategoryPage from "./categoria/[slug]/page";
import SearchPage from "./buscar/page";
beforeEach(() => {readers.category.mockReset();readers.search.mockReset();readers.facets.mockReset().mockResolvedValue({brands:[],categories:[]});});
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
 expect(screen.getByRole("status")).toHaveTextContent("0 productos");
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
  expect(screen.getByRole("link", {name: /anterior/i})).toHaveAttribute("href", "/buscar?q=cable");
  expect(screen.queryByRole("link", {name: /siguiente/i})).toBeNull();
});

it("keeps a search outage available on a high page", async () => {
  readers.search.mockRejectedValueOnce(new Error("SECRET SQL synthetic"));
  const outage = render(await SearchPage({ searchParams: Promise.resolve({q: "cable", page: "999"}) }));
  expect(screen.getByText("El catálogo todavía no está disponible.")).toBeInTheDocument();
  expect(outage.container.textContent).not.toContain("SECRET SQL");
  expect(screen.getByRole("status")).toHaveTextContent("El catálogo todavía no está disponible.");
  expect(outage.container.querySelector("[data-catalog-result-count]")).toBeNull();
});
it("skips the catalog read for short queries even on a high page", async () => {
  readers.search.mockClear();
  const props = { searchParams: Promise.resolve({q: " a ", page: "999"}) };
  render(await SearchPage(props));
  expect(readers.search).not.toHaveBeenCalled();
  expect(readers.facets).not.toHaveBeenCalled();
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.queryByText("El catálogo todavía no está disponible.")).toBeNull();
});
it("parses the first query values and preserves the encoded search in continuation links", async () => {
  readers.search.mockResolvedValueOnce({ products: [{id: 1, name: "Cable"}], total: 41, page: 1, totalPages: 2 });
  render(await SearchPage({ searchParams: Promise.resolve({q: [" cable & usb ", "ignored"], page: ["invalid", "999"]}) }));
  expect(readers.search).toHaveBeenLastCalledWith("cable & usb", {page:1,categorySlug:undefined,brand:undefined,minPricePyg:undefined,maxPricePyg:undefined,sort:"relevancia"});
  expect(readers.facets).toHaveBeenCalledWith("cable & usb");
  const next = new URL(screen.getByRole("link", {name:/siguiente/i}).getAttribute("href")!,"https://fixture.invalid");
  expect(next.pathname).toBe("/buscar");expect(next.searchParams.get("q")).toBe("cable & usb");expect(next.searchParams.get("page")).toBe("2");expect(next.search).not.toContain("ignored");
});

it("forwards combined search filters and normalized inclusive budget without losing query pagination", async () => {
 readers.search.mockResolvedValueOnce({products:[{id:1,name:"Cable"}],total:41,page:1,totalPages:2});
 readers.facets.mockResolvedValueOnce({brands:[{brand:"A",total:41}],categories:[{slug:"tools",name:"Tools",total:41}]});
 render(await SearchPage({searchParams:Promise.resolve({q:"cable",marca:"A",categoria:"tools",min:"300",max:"100"})}));
 expect(readers.search).toHaveBeenCalledWith("cable",{page:1,categorySlug:"tools",brand:"A",minPricePyg:100,maxPricePyg:300,sort:"relevancia"});
 expect(readers.facets).toHaveBeenCalledWith("cable");
 const next=new URL(screen.getByRole("link",{name:/siguiente/i}).getAttribute("href")!,"https://fixture.invalid");
 expect([...next.searchParams.entries()]).toEqual([["q","cable"],["marca","A"],["categoria","tools"],["min","300"],["max","100"],["page","2"]]);
});
it("rejects malformed integer budgets without reading products or claiming an outage",async()=>{
 render(await SearchPage({searchParams:Promise.resolve({q:"cable",min:"1.5"})}));
 expect(readers.search).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toHaveTextContent("montos enteros");
 expect(screen.queryByText("El catálogo todavía no está disponible.")).toBeNull();
});
