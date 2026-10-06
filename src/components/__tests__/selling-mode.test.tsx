import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AddToCart } from "@/components/add-to-cart";
import type { CatalogProductDetail } from "@/db/queries";
import { TESTIDS } from "@/lib/testids";
import { waLink } from "@/lib/py";

const product: CatalogProductDetail = {
  id: 1,
  slug: "ring",
  name: "Ring",
  saleMode: "enquiry",
  showPrice: false,
  brand: null,
  ivaRate: 10,
  categorySlug: "rings",
  categoryName: "Rings",
  image: null,
  images: [],
  description: null,
  variants: [
    {
      id: 1,
      sku: "RING-S",
      label: "Small",
      pricePyg: 123456,
      compareAtPyg: null,
      available: 0,
    },
    {
      id: 2,
      sku: "RING-L",
      label: "Large",
      pricePyg: 654321,
      compareAtPyg: null,
      available: 0,
    },
  ],
};
describe("enquiry selector", () => {
  afterEach(cleanup);
  it("allows unavailable variants and follows only their server supplied enquiry links", () => {
    const { container } = render(
      <AddToCart
        product={product}
        inquiryLinks={{
          1: waLink("+595981123456", "RING-S"),
          2: waLink("+595981123456", "RING-L"),
        }}
      />
    );
    expect(screen.getByRole("button", { name: "Large" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Large" }));
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining("RING-L")
    );
    expect(
      screen.queryByTestId(TESTIDS.productAddToCart)
    ).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/123\.456|654\.321|₲/);
  });
  it.each(["enquiry", "showcase"] as const)(
    "missing contact shows %s without a purchase or dead enquiry button",
    (saleMode) => {
      render(<AddToCart product={{ ...product, saleMode }} />);
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(TESTIDS.productAddToCart)
      ).not.toBeInTheDocument();
    }
  );
});
