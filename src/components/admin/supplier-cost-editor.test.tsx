import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupplierCostEditor } from "./supplier-cost-editor";
const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/actions/admin-products", () => ({
  saveVariantSupplierCost: mocks.save,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
const offer = {
  id: 1,
  variantId: 2,
  source: "MarketPro",
  sourceType: "dropi" as const,
  unitCostPyg: 23000,
  productUrl: "https://app.dropi.com.py/dashboard/product-details/13535/a",
  supplierUrl: null,
  supplierStock: 111,
  checkedAt: new Date("2026-10-08T19:05:00Z"),
  updatedAt: new Date("2026-10-09T10:00:00Z"),
  notes: null,
  isPreferred: true,
  isConfirmed: true,
  isActive: true,
};
describe("supplier comparison editor", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.save.mockResolvedValue({ ok: true });
  });
  it("shows supplier alternatives, captured stock and the preferred margin without exposing inventory controls", () => {
    render(
      <SupplierCostEditor
        productId={3}
        ready
        variant={{
          id: 2,
          sku: "SHARPENER",
          pricePyg: 69000,
          supplierOffers: [
            offer,
            {
              ...offer,
              id: 2,
              source: "Wit",
              unitCostPyg: 18000,
              isPreferred: false,
              isConfirmed: false,
            },
          ],
        }}
      />
    );
    expect(
      screen.getByText("Preferido · usado para margen")
    ).toBeInTheDocument();
    expect(screen.getByText("Pendiente de comparar")).toBeInTheDocument();
    expect(screen.getAllByText(/Stock del proveedor: 111/)).toHaveLength(2);
    expect(screen.getByText(/66.7%/)).toBeInTheDocument();
    expect(screen.getAllByRole("link")[0]).toHaveAttribute(
      "href",
      offer.productUrl
    );
  });
  it("adds an unknown-cost source as a pending offer, not a confirmed or preferred one", async () => {
    render(
      <SupplierCostEditor
        productId={3}
        ready
        variant={{
          id: 2,
          sku: "SHARPENER",
          pricePyg: 69000,
          supplierOffers: [],
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Agregar proveedor" }));
    fireEvent.change(screen.getByLabelText(/Proveedor o fuente/), {
      target: { value: "CDE proveedor nuevo" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Guardar oferta privada" })
    );
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({
          variantId: 2,
          productId: 3,
          unitCostPyg: null,
          supplierStock: null,
          checkedAt: null,
          isConfirmed: false,
          isPreferred: false,
          isActive: true,
        })
      )
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("disables writes while the additive migration is unavailable", () => {
    render(
      <SupplierCostEditor
        productId={3}
        ready={false}
        variant={{
          id: 2,
          sku: "SHARPENER",
          pricePyg: 69000,
          supplierOffers: [],
        }}
      />
    );
    expect(
      screen.getByRole("button", { name: "Agregar proveedor" })
    ).toBeDisabled();
  });
});
