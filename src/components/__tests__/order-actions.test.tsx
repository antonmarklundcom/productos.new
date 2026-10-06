import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrderActions } from "@/components/admin/order-actions";
import { TESTIDS } from "@/lib/testids";

const { advanceOrder } = vi.hoisted(() => ({ advanceOrder: vi.fn() }));

vi.mock("@/app/actions/admin-orders", () => ({ advanceOrder }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * `OrderActions` (plan-operacion §6.4): los botones se dibujan uno por
 * `nextStatuses` — nunca los inventa el cliente, `transitionOrder` valida
 * la arista otra vez — y los tres campos de tracking sólo aparecen cuando
 * el paso intermedio es para `enviado` (S9, `needsConfirmStep`).
 */
describe("OrderActions", () => {
  afterEach(cleanup);

  it("dibuja un botón por cada estado siguiente permitido, y ninguno más", () => {
    render(<OrderActions orderId={1} nextStatuses={["pagado", "rechazado"]} />);

    const buttons = screen.getAllByTestId(TESTIDS.orderTransitionButton);
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.getAttribute("data-status"))).toEqual(["pagado", "rechazado"]);
  });

  it("sin próximos estados no dibuja ningún botón de transición", () => {
    render(<OrderActions orderId={1} nextStatuses={[]} />);
    expect(screen.queryByTestId(TESTIDS.orderTransitionButton)).not.toBeInTheDocument();
  });

  it("el paso intermedio de `enviado` muestra los tres campos de tracking", async () => {
    render(<OrderActions orderId={1} nextStatuses={["enviado"]} />);

    fireEvent.click(screen.getByTestId(TESTIDS.orderTransitionButton));

    expect(screen.getByTestId(TESTIDS.orderTrackingBlockForm)).toBeInTheDocument();
    expect(screen.getByTestId(TESTIDS.orderTrackingCarrierInput)).toBeInTheDocument();
    expect(screen.getByTestId(TESTIDS.orderTrackingCodeInput)).toBeInTheDocument();
    expect(screen.getByTestId(TESTIDS.orderTrackingUrlInput)).toBeInTheDocument();
  });

  it("el paso intermedio de una transición destructiva no muestra tracking", async () => {
    render(<OrderActions orderId={1} nextStatuses={["cancelado"]} />);

    fireEvent.click(screen.getByTestId(TESTIDS.orderTransitionButton));

    expect(screen.queryByTestId(TESTIDS.orderTrackingBlockForm)).not.toBeInTheDocument();
  });

  it("confirmar `enviado` manda el tracking cargado a `advanceOrder`", async () => {
    advanceOrder.mockResolvedValue({ ok: true });
    render(<OrderActions orderId={42} nextStatuses={["enviado"]} />);

    fireEvent.click(screen.getByTestId(TESTIDS.orderTransitionButton));
    fireEvent.change(screen.getByTestId(TESTIDS.orderTrackingCarrierInput), { target: { value: "OCA" } });
    fireEvent.change(screen.getByTestId(TESTIDS.orderTrackingCodeInput), { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId(TESTIDS.orderTransitionConfirm));

    expect(advanceOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 42,
        to: "enviado",
        tracking: expect.objectContaining({ carrier: "OCA", code: "123456" }),
      })
    );
  });

  it("confirmar un estado que no es `enviado` manda `tracking: undefined`", async () => {
    advanceOrder.mockResolvedValue({ ok: true });
    render(<OrderActions orderId={7} nextStatuses={["cancelado"]} />);

    fireEvent.click(screen.getByTestId(TESTIDS.orderTransitionButton));
    fireEvent.click(screen.getByTestId(TESTIDS.orderTransitionConfirm));

    expect(advanceOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 7, to: "cancelado", tracking: undefined })
    );
  });
});
