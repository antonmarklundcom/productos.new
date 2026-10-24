import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecentlyViewed } from "./recently-viewed";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("RecentlyViewed", () => {
  it("stores identifiers only and renders freshly revalidated public cards", async () => {
    localStorage.setItem(
      "tienda-py-cart-vistos",
      JSON.stringify([
        { slug: "viejo", name: "Precio antiguo", pricePyg: 1, imageCloudinaryId: null, imageAlt: null },
      ])
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        products: [
          { slug: "actual", name: "Producto actual", pricePyg: 5000, imageCloudinaryId: null, imageAlt: null },
          { slug: "viejo", name: "Nombre actualizado", pricePyg: 125000, imageCloudinaryId: null, imageAlt: null },
          { slug: "sin-precio", name: "Sin precio público", pricePyg: null, imageCloudinaryId: null, imageAlt: null },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<RecentlyViewed current={{ slug: "actual" }} />);

    await waitFor(() => expect(screen.getByText("Nombre actualizado")).toBeInTheDocument());
    expect(screen.getByText("\u20b2 125.000")).toBeInTheDocument();
    expect(screen.getByText("Sin precio público")).toBeInTheDocument();
    expect(screen.queryByText("Gs. 1")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/catalog/recently-viewed?slugs=actual%2Cviejo",
      expect.objectContaining({ cache: "no-store" })
    );
    const stored = localStorage.getItem("tienda-py-cart-vistos") ?? "";
    expect(stored).toContain("viewedAt");
    expect(stored).not.toContain("pricePyg");
    expect(stored).not.toContain("name");
  });
});
