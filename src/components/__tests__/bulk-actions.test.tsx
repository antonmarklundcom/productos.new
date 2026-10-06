import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BulkActionsBar } from "@/components/admin/bulk-actions";
import { TESTIDS } from "@/lib/testids";

vi.mock("@/app/actions/admin-products", () => ({
  bulkMoveProductsCategory: vi.fn(),
  bulkSetProductsActive: vi.fn(),
  duplicateProductAction: vi.fn(),
  previewBulkPriceAdjustment: vi.fn(),
  bulkAdjustProductPrices: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const CATEGORIES = [{ id: 1, name: "Deportes" }];

/**
 * `BulkActionsBar` (plan-operacion §6.4): activar/desactivar/mover de
 * categoría son de siempre — el botón de precios masivos ("owner-only",
 * `precios.masivo`) es lo único que este componente decide mostrar u
 * ocultar del lado del cliente, y `canBulkPrice` es la única entrada que lo
 * gobierna (el guard real vive en el servidor, en `bulkAdjustProductPrices`).
 */
describe("BulkActionsBar", () => {
  afterEach(cleanup);

  it("sin `canBulkPrice` no dibuja el botón de ajustar precios", () => {
    render(
      <BulkActionsBar
        productIds={[1, 2]}
        categories={CATEGORIES}
        canBulkPrice={false}
        onDone={vi.fn()}
      />
    );

    expect(screen.queryByTestId(TESTIDS.adminBulkPriceOpen)).not.toBeInTheDocument();
    // el resto de la barra, que no depende del rol, sigue ahí:
    expect(screen.getByTestId(TESTIDS.adminBulkActivate)).toBeInTheDocument();
    expect(screen.getByTestId(TESTIDS.adminBulkDeactivate)).toBeInTheDocument();
  });

  it("con `canBulkPrice` el botón de ajustar precios se dibuja", () => {
    render(
      <BulkActionsBar
        productIds={[1, 2]}
        categories={CATEGORIES}
        canBulkPrice={true}
        onDone={vi.fn()}
      />
    );

    expect(screen.getByTestId(TESTIDS.adminBulkPriceOpen)).toBeInTheDocument();
  });
});
