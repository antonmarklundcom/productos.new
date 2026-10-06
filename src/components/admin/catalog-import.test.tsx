import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogImportForm } from "./catalog-import";

const actions = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }));
vi.mock("@/app/actions/admin-products", () => ({ previewCatalogImport: actions.preview, applyCatalogImport: actions.apply }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
const summary = { productosNuevos: 1, productosActualizar: 0, variantesNuevas: 1, variantesActualizar: 0, categoriasNuevas: [], pisaStock: false, fotosNuevas: 0 };
const csv = 'SKU,Producto,Descripción\nD1,"Cepillo ñ","Texto con ""comillas""\ny segunda línea"\n';
const readFile = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = reject;
  reader.readAsText(file);
});
async function pasteAndPreview() {
  fireEvent.click(screen.getByLabelText("Pegar CSV"));
  fireEvent.change(screen.getByLabelText("Contenido CSV"), { target: { value: csv } });
  fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
  await screen.findByRole("button", { name: "Confirmar e importar" });
}

describe("catalog import paste fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.preview.mockResolvedValue({ ok: true, ...summary });
    actions.apply.mockResolvedValue({ ok: true, ...summary, variantesEscritas: 1, fotosSubidas: 0, fotosOmitidas: 0, fotosFallidas: [] });
  });
  afterEach(cleanup);

  it("previews and confirms the exact CSV through the existing File flow with stock overwrite off", async () => {
    render(<CatalogImportForm />);
    expect(screen.queryByRole("button", { name: "Confirmar e importar" })).not.toBeInTheDocument();
    await pasteAndPreview();
    expect(actions.apply).not.toHaveBeenCalled();
    const preview = actions.preview.mock.calls[0]![0] as FormData;
    const file = preview.get("file") as File;
    expect(file.name).toBe("catalogo.csv");
    expect(file.type).toBe("text/csv");
    expect(await readFile(file)).toBe(csv);
    expect(preview.get("pisarStock")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e importar" }));
    await waitFor(() => expect(actions.apply).toHaveBeenCalledOnce());
    const applied = actions.apply.mock.calls[0]![0] as FormData;
    expect(await readFile(applied.get("file") as File)).toBe(csv);
    expect(applied.get("pisarStock")).toBe("false");
  });

  it("invalidates the prior preview when pasted content changes or source switches", async () => {
    render(<CatalogImportForm />);
    await pasteAndPreview();
    fireEvent.change(screen.getByLabelText("Contenido CSV"), { target: { value: csv + "D2,Otro,Texto" } });
    expect(screen.queryByRole("button", { name: "Confirmar e importar" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await screen.findByRole("button", { name: "Confirmar e importar" });
    fireEvent.click(screen.getByLabelText("Subir archivo"));
    expect(screen.queryByRole("button", { name: "Confirmar e importar" })).not.toBeInTheDocument();
    expect(actions.apply).not.toHaveBeenCalled();
  });

  it("retains file upload and rejects empty pasted input before preview", async () => {
    render(<CatalogImportForm />);
    const upload = screen.getByLabelText("Cargar planilla");
    const file = new File([csv], "original.csv", { type: "text/csv" });
    fireEvent.change(upload, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await screen.findByRole("button", { name: "Confirmar e importar" });
    expect(await readFile(actions.preview.mock.calls[0]![0].get("file"))).toBe(csv);
    fireEvent.click(screen.getByLabelText("Pegar CSV"));
    expect(screen.getByRole("button", { name: "Revisar" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Confirmar e importar" })).not.toBeInTheDocument();
  });
});
