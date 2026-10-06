import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrderNotes } from "@/components/admin/order-notes";
import { TESTIDS } from "@/lib/testids";

const { addOrderNote } = vi.hoisted(() => ({ addOrderNote: vi.fn() }));

vi.mock("@/app/actions/admin-orders", () => ({ addOrderNote }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * `OrderNotes` (plan-operacion §6.4): el contador acompaña lo que se
 * escribe, y el botón de guardar se deshabilita mientras la acción está en
 * vuelo — nunca dos clicks disparan dos notas iguales.
 */
describe("OrderNotes", () => {
  afterEach(cleanup);

  it("sin notas todavía, lo dice", () => {
    render(<OrderNotes orderId={1} notes={[]} />);
    expect(screen.queryByTestId(TESTIDS.orderNotesList)).not.toBeInTheDocument();
  });

  it("el contador sigue lo que se escribe en el textarea", () => {
    render(<OrderNotes orderId={1} notes={[]} />);

    const textarea = screen.getByTestId(TESTIDS.orderNotesTextarea);
    expect(screen.getByText("0/1000")).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "Llamó, pasa el jueves" } });

    expect(screen.getByText("21/1000")).toBeInTheDocument();
  });

  it("el botón de guardar arranca deshabilitado sin texto", () => {
    render(<OrderNotes orderId={1} notes={[]} />);
    expect(screen.getByTestId(TESTIDS.orderNotesSubmit)).toBeDisabled();
  });

  it("con texto cargado, el botón de guardar se habilita", () => {
    render(<OrderNotes orderId={1} notes={[]} />);

    fireEvent.change(screen.getByTestId(TESTIDS.orderNotesTextarea), {
      target: { value: "Nota" },
    });

    expect(screen.getByTestId(TESTIDS.orderNotesSubmit)).not.toBeDisabled();
  });

  it("mientras la acción está en vuelo, el botón queda deshabilitado", async () => {
    let resolveAction: (value: { ok: true }) => void = () => {};
    addOrderNote.mockReturnValue(new Promise((resolve) => (resolveAction = resolve)));

    render(<OrderNotes orderId={1} notes={[]} />);

    fireEvent.change(screen.getByTestId(TESTIDS.orderNotesTextarea), {
      target: { value: "Nota en vuelo" },
    });
    fireEvent.click(screen.getByTestId(TESTIDS.orderNotesSubmit));

    expect(screen.getByTestId(TESTIDS.orderNotesSubmit)).toBeDisabled();

    resolveAction({ ok: true });
    await waitFor(() => expect(addOrderNote).toHaveBeenCalledTimes(1));
  });

  it("una nota existente se lista con autor y fecha", () => {
    render(
      <OrderNotes
        orderId={1}
        notes={[{ id: 1, body: "Retira el jueves", author: "Dueño CI", createdAt: "06/09/2026 10:00" }]}
      />
    );

    expect(screen.getByTestId(TESTIDS.orderNotesList)).toBeInTheDocument();
    expect(screen.getByText("Retira el jueves")).toBeInTheDocument();
    expect(screen.getByText("Dueño CI · 06/09/2026 10:00")).toBeInTheDocument();
  });
});
