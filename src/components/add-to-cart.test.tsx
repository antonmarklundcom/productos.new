import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddToCart } from "./add-to-cart";

vi.mock("@/lib/cart-store", () => ({ useCart: () => ({ add: vi.fn() }) }));
vi.mock("@/lib/variant-memory", () => ({ recallVariant: () => null, rememberVariant: vi.fn() }));
vi.mock("@/lib/funnel", () => ({ sendFunnelEvent: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

afterEach(cleanup);

describe("AddToCart variant selection", () => {
  it("announces the selected variant and keeps keyboard focus visible", () => {
    render(
      <AddToCart
        product={{
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
        }}
      />
    );
    const first = screen.getByRole("button", { name: "500 ml" });
    const second = screen.getByRole("button", { name: "750 ml" });
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveClass("focus-visible:ring-2");
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveAttribute("aria-pressed", "false");
  });
});
