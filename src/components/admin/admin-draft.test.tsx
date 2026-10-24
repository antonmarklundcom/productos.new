import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  AdminDraftScope,
  clearAdminDrafts,
  useAdminDraft,
} from "./admin-draft";
import {
  ProductRevisionProvider,
  useProductRevision,
} from "./product-revision";
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
function Editor({ version = 1 }: { version?: number }) {
  const { bindForm, onInput, clear, recovery } = useAdminDraft("test", version);
  const [value, setValue] = useState("original");
  return (
    <form ref={bindForm} onInput={onInput}>
      {recovery}
      <label>
        Nombre
        <input
          name="name"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <label>
        Activo
        <input name="active" type="checkbox" defaultChecked />
      </label>
      <button type="button" onClick={clear}>
        Guardado
      </button>
      <output>{value}</output>
    </form>
  );
}
it("recovers controlled fields and unchecked values after reload and clears only after acknowledged save", async () => {
  const first = render(<Editor />);
  fireEvent.change(screen.getByLabelText("Nombre"), {
    target: { value: "mi borrador" },
  });
  fireEvent.input(screen.getByLabelText("Nombre"));
  fireEvent.click(screen.getByLabelText("Activo"));
  first.unmount();
  render(<Editor />);
  fireEvent.click(await screen.findByText("Recuperar borrador"));
  expect(screen.getByLabelText("Nombre")).toHaveValue("mi borrador");
  expect(screen.getByLabelText("Activo")).not.toBeChecked();
  expect(screen.getByText("mi borrador")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Guardado"));
  expect(sessionStorage.getItem("admin-draft:isolated:test")).toBeNull();
});
it("requires deliberate rebase of a recovered draft from an older version", async () => {
  sessionStorage.setItem(
    "admin-draft:isolated:test",
    JSON.stringify({ version: "1", values: [["name", "stale"]] })
  );
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<Editor version={2} />);
  fireEvent.click(await screen.findByText("Recuperar borrador"));
  expect(screen.getByLabelText("Nombre")).toHaveValue("original");
  expect(window.confirm).toHaveBeenCalledOnce();
});
function Panel() {
  const { revision, acknowledge } = useProductRevision();
  return (
    <>
      <output aria-label="versión">{revision}</output>
      <button onClick={() => acknowledge(revision)}>Guardar panel</button>
    </>
  );
}
it("acknowledges own sibling saves while refusing an unsolicited refreshed revision", () => {
  const view = render(
    <ProductRevisionProvider revision={1}>
      <Panel />
    </ProductRevisionProvider>
  );
  fireEvent.click(screen.getByText("Guardar panel"));
  expect(screen.getByLabelText("versión")).toHaveTextContent("2");
  view.rerender(
    <ProductRevisionProvider revision={7}>
      <Panel />
    </ProductRevisionProvider>
  );
  expect(screen.getByLabelText("versión")).toHaveTextContent("2");
});

it("isolates actor drafts and clears private drafts on deliberate logout", async () => {
  sessionStorage.setItem(
    "admin-draft:1:test",
    JSON.stringify({ version: "1", values: [["name", "owner draft"]] })
  );
  const view = render(
    <AdminDraftScope actorId={2}>
      <Editor />
    </AdminDraftScope>
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText("Recuperar borrador")).toBeNull();
  view.unmount();
  render(
    <AdminDraftScope actorId={1}>
      <Editor />
    </AdminDraftScope>
  );
  expect(await screen.findByText("Recuperar borrador")).toBeInTheDocument();
  clearAdminDrafts();
  expect(sessionStorage.getItem("admin-draft:1:test")).toBeNull();
});
