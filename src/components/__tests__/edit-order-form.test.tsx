import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditOrderForm } from "@/components/admin/edit-order-form";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

const { editPendingOrderAction } = vi.hoisted(() => ({ editPendingOrderAction: vi.fn() }));

vi.mock("@/app/actions/admin-orders", () => ({ editPendingOrderAction }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ITEMS = [{ orderItemId: 1, nameSnapshot: "Remera azul", qty: 2 }];
const SHIPPING_METHODS = [{ id: 10, name: "Moto propia" }];

/**
 * `EditOrderForm` (O16 + S17, plan-crecimiento.md §6.1 D/G).
 *
 * El navegador nunca calcula el total: éste sólo se prueba mostrando lo que
 * la acción del servidor devuelve, nunca una cuenta hecha acá adentro con
 * `qty * unitPricePyg`.
 */
describe("EditOrderForm", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("arranca colapsado, con sólo el botón para abrir", () => {
    render(
      <EditOrderForm
        orderId={1}
        customerPhone="+595981234567"
        items={ITEMS}
        shipCity="Asunción"
        shipAddress="Mcal. López 1234"
        shipReference={null}
        shippingMethods={SHIPPING_METHODS}
        currentShippingMethodId={10}
      />
    );

    expect(screen.getByTestId(TESTIDS.adminEditOrderOpen)).toBeInTheDocument();
    expect(screen.queryByTestId(TESTIDS.adminEditOrderSubmit)).not.toBeInTheDocument();
  });

  it("muestra el total antes → después de la respuesta del servidor, y el aviso de cupón quitado", async () => {
    editPendingOrderAction.mockResolvedValue({
      ok: true,
      resultado: {
        orderId: 1,
        orderNumber: "PY-000001",
        accessToken: "tok",
        previousTotalPyg: 150_000,
        subtotalPyg: 100_000,
        discountPyg: 0,
        shippingPyg: 0,
        totalPyg: 100_000,
        iva10Pyg: 9091,
        iva5Pyg: 0,
        shipCity: "Asunción",
        shipAddress: "Mcal. López 1234",
        shipReference: null,
        shippingMethodId: 10,
        shippingMethodName: "Moto propia",
        reservedUntil: null,
        couponRemoved: true,
        removedCouponCode: "BIENVENIDA10",
        lines: [],
      },
      whatsapp: "Listo, tu pedido PY-000001 quedó en ₲ 100.000.",
    });

    render(
      <EditOrderForm
        orderId={1}
        customerPhone="+595981234567"
        items={ITEMS}
        shipCity="Asunción"
        shipAddress="Mcal. López 1234"
        shipReference={null}
        shippingMethods={SHIPPING_METHODS}
        currentShippingMethodId={10}
      />
    );

    fireEvent.click(screen.getByTestId(TESTIDS.adminEditOrderOpen));

    fireEvent.change(screen.getByTestId(TESTIDS.adminEditOrderReason), {
      target: { value: "La compradora pidió bajar una unidad" },
    });
    fireEvent.click(screen.getByTestId(TESTIDS.adminEditOrderSubmit));

    await waitFor(() => {
      expect(screen.getByTestId(TESTIDS.adminEditOrderResult)).toBeInTheDocument();
    });

    const result = screen.getByTestId(TESTIDS.adminEditOrderResult);
    expect(result).toHaveTextContent("₲");
    expect(screen.getByTestId(TESTIDS.adminEditOrderCuponQuitado)).toHaveTextContent("BIENVENIDA10");
    expect(screen.getByTestId(TESTIDS.adminEditOrderWhatsapp)).toBeInTheDocument();

    expect(editPendingOrderAction).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 1,
        items: [{ orderItemId: 1, qty: 2 }],
        reason: "La compradora pidió bajar una unidad",
      })
    );
  });

  it("un motivo corto no manda la acción y muestra el error en pantalla", () => {
    render(
      <EditOrderForm
        orderId={1}
        customerPhone="+595981234567"
        items={ITEMS}
        shipCity="Asunción"
        shipAddress="Mcal. López 1234"
        shipReference={null}
        shippingMethods={SHIPPING_METHODS}
        currentShippingMethodId={10}
      />
    );

    fireEvent.click(screen.getByTestId(TESTIDS.adminEditOrderOpen));
    fireEvent.click(screen.getByTestId(TESTIDS.adminEditOrderSubmit));

    expect(editPendingOrderAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("\"Quitar\" baja la cantidad de esa línea a cero", () => {
    render(
      <EditOrderForm
        orderId={1}
        customerPhone="+595981234567"
        items={ITEMS}
        shipCity="Asunción"
        shipAddress="Mcal. López 1234"
        shipReference={null}
        shippingMethods={SHIPPING_METHODS}
        currentShippingMethodId={10}
      />
    );

    fireEvent.click(screen.getByTestId(TESTIDS.adminEditOrderOpen));
    fireEvent.click(screen.getByRole("button", { name: t("panel.pedido.editar.quitar") }));

    const input = screen.getByTestId(TESTIDS.adminEditOrderQty) as HTMLInputElement;
    expect(input.value).toBe("0");
  });
});
