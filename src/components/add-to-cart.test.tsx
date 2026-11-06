import { waLink } from "@/lib/py";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CatalogProductDetail } from "@/db/queries";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddToCart } from "./add-to-cart";

vi.mock("@/lib/cart-store", () => ({ useCart: () => ({ add: vi.fn() }) }));
vi.mock("@/lib/variant-memory", () => ({ recallVariant: () => null, rememberVariant: vi.fn() }));
vi.mock("@/lib/funnel", () => ({ sendFunnelEvent: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AddToCart variant selection", () => {
  const product: CatalogProductDetail = {
    id: 3,
    slug: "vaso-termico",
    name: "Vaso térmico",
    brand: null,
    ivaRate: 10,
    categoryName: "Hogar",
    categorySlug: "hogar-y-cocina",
    image: null,
    images: [],
    description: null,
    saleMode: "stock",
    showPrice: true,
    variants: [
      { id: 11, sku: "VASO-500", label: "500 ml", pricePyg: 25000, compareAtPyg: null, available: 2 },
      { id: 12, sku: "VASO-750", label: "750 ml", pricePyg: 30000, compareAtPyg: null, available: 1 },
    ],
  };

  it("announces the selected variant and keeps keyboard focus visible", () => {
    render(<AddToCart product={product} />);
    const first = screen.getByRole("button", { name: "500 ml" });
    const second = screen.getByRole("button", { name: "750 ml" });
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveClass("focus-visible:ring-2");
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("IVA incluido")).toBeInTheDocument();
  });

  it("keeps the mobile enquiry linked to the selected variant until the inline action is visible", () => {
    let notify: IntersectionObserverCallback;
    class TestObserver {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", TestObserver);
    const setVisibility = (ratio: number) => act(() => {
      notify(
        [{ intersectionRatio: ratio, isIntersecting: ratio > 0 } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    const firstHref = waLink("595991000001", "VASO-500");
    const secondHref = waLink("595991000001", "VASO-750");
    render(
      <AddToCart
        product={{ ...product, saleMode: "enquiry" }}
        inquiryLinks={{ 11: firstHref, 12: secondHref }}
      />
    );

    expect(screen.getByText("Precio orientativo. Confirmalo al consultar.")).toBeInTheDocument();
    expect(screen.queryByText("IVA incluido")).not.toBeInTheDocument();
    const name = "Consultar por WhatsApp";
    setVisibility(0);
    const sticky = screen.getByRole("region", { name });
    const mobileLink = within(sticky).getByRole("link", { name });
    expect(mobileLink).toHaveAttribute("href", firstHref);

    fireEvent.click(screen.getByRole("button", { name: "750 ml" }));
    expect(mobileLink).toHaveAttribute("href", secondHref);
    expect(within(sticky).getByText("750 ml")).toBeInTheDocument();

    setVisibility(1);
    expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", secondHref);
  });
});
