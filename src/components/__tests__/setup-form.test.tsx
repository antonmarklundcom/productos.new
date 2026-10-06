import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SetupForm } from "@/components/setup-form";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillOwner(password: string, confirmation: string) {
  fireEvent.change(screen.getByLabelText("SETUP_SECRET"), {
    target: { value: "test-only-setup-value" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Contraseña"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Repetir contraseña"), {
    target: { value: confirmation },
  });
}

describe("SetupForm", () => {
  it("blocks mismatched owner passwords before making a setup request", () => {
    render(<SetupForm />);
    fillOwner("test-only-entry", "different-test-entry");
    fireEvent.click(screen.getByRole("button", { name: "Inicializar" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Las contraseñas no coinciden"
    );
    expect(screen.getByLabelText("Repetir contraseña")).toHaveFocus();

    fireEvent.change(screen.getByLabelText("Repetir contraseña"), {
      target: { value: "test-only-entry" },
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reveals both owner entries without revealing the setup secret", () => {
    render(<SetupForm />);
    fillOwner("test-only-entry", "test-only-entry");
    const toggle = screen.getByRole("checkbox", {
      name: "Mostrar contraseñas",
    });
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute(
      "type",
      "password"
    );
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Repetir contraseña")).toHaveAttribute(
      "type",
      "text"
    );
    expect(screen.getByLabelText("SETUP_SECRET")).toHaveAttribute(
      "type",
      "password"
    );
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute(
      "type",
      "password"
    );
    expect(screen.getByLabelText("Repetir contraseña")).toHaveAttribute(
      "type",
      "password"
    );
    expect(screen.getByLabelText("Contraseña")).toHaveValue("test-only-entry");
  });

  it("submits matching entries once, excludes confirmation, and clears the form", async () => {
    render(<SetupForm />);
    fillOwner("test-only-entry", "test-only-entry");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mostrar contraseñas" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Inicializar" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Listo")
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) throw new Error("Expected one setup request");
    const [url, request] = firstCall;
    expect(url).toBe("/api/setup/init");
    expect(JSON.parse(request.body)).toEqual({
      seed: false,
      force: false,
      owner: { email: "owner@example.test", password: "test-only-entry" },
    });
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
    expect(screen.getByLabelText("Repetir contraseña")).toHaveValue("");
    expect(screen.getByLabelText("SETUP_SECRET")).toHaveValue("");
    expect(
      screen.getByRole("checkbox", { name: "Mostrar contraseñas" })
    ).not.toBeChecked();
    await waitFor(() => expect(screen.getByRole("status")).toHaveFocus());
    expect(
      screen.getByRole("link", { name: "Ir al inicio de sesión del admin" })
    ).toHaveAttribute("href", "/admin/login");
    expect(
      screen
        .getByRole("status")
        .compareDocumentPosition(screen.getByLabelText("SETUP_SECRET")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("keeps migration-only setup available without owner password fields", async () => {
    render(<SetupForm />);
    fireEvent.change(screen.getByLabelText("SETUP_SECRET"), {
      target: { value: "test-only-setup-value" },
    });
    expect(screen.getByLabelText("Contraseña")).not.toBeRequired();
    expect(screen.getByLabelText("Repetir contraseña")).not.toBeRequired();
    fireEvent.click(screen.getByRole("button", { name: "Inicializar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) throw new Error("Expected one setup request");
    expect(JSON.parse(firstCall[1].body)).toEqual({
      seed: false,
      force: false,
    });
  });
});
