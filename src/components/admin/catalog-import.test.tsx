import { webcrypto } from "node:crypto";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogImportForm } from "./catalog-import";

const capabilities = vi.hoisted(() => ({ catalogOnly: false }));
vi.mock("@/config/catalog-capabilities", () => capabilities);
const actions = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }));
vi.mock("@/app/actions/admin-products", () => ({
  previewCatalogImport: actions.preview,
  applyCatalogImport: actions.apply,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
const summary = {
  productosNuevos: 1,
  productosActualizar: 0,
  variantesNuevas: 1,
  variantesActualizar: 0,
  categoriasNuevas: [],
  pisaStock: false,
  fotosNuevas: 0,
};
const csv =
  'SKU,Producto,Descripción\nD1,"Cepillo ñ","Texto con ""comillas""\ny segunda línea"\n';
const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(file);
  });
async function pasteAndPreview() {
  fireEvent.click(screen.getByLabelText("Pegar CSV"));
  fireEvent.change(screen.getByLabelText("Contenido CSV"), {
    target: { value: csv },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
  await screen.findByRole("button", { name: "Confirmar e importar" });
}

describe("catalog import paste fallback", () => {
  it("requires duplicate review and sends the reviewed warning list", async () => {
    const advertencias = ["Posible producto repetido: afilador"];
    actions.preview.mockResolvedValue({ ok: true, ...summary, advertencias });
    render(<CatalogImportForm />);
    await pasteAndPreview();
    const confirm = screen.getByRole("button", {
      name: "Confirmar e importar",
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Revisé estos posibles duplicados/));
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.apply).toHaveBeenCalledOnce());
    expect(
      (actions.apply.mock.calls[0]![0] as FormData).get("duplicateReview")
    ).toBe(JSON.stringify(advertencias));
  });
  it("normal Next imports neither persist an identity nor promise receipt-based resume", async () => {
    sessionStorage.setItem("catalog-import-v1", "malformed pending Worker identity");
    const stored = sessionStorage.getItem("catalog-import-v1");
    const digest = vi.spyOn(webcrypto.subtle, "digest");
    render(<CatalogImportForm />);
    expect(screen.queryByRole("button", {name: /Nueva importaci/})).not.toBeInTheDocument();
    expect(screen.queryByText(/lotes confirmados/)).not.toBeInTheDocument();
    await pasteAndPreview();
    fireEvent.click(screen.getByRole("button", {name: "Confirmar e importar"}));
    await waitFor(() => expect(actions.apply).toHaveBeenCalledOnce());
    expect((actions.apply.mock.calls[0]![0] as FormData).get("importId")).toBeNull();
    expect(digest).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("catalog-import-v1")).toBe(stored);
    digest.mockRestore();
  });
  it.each([/Pisar el stock/, /Reactivar productos/, /Preparar y publicar/])("reuses the pending import identity after reload and rejects changed option %s", async(option)=>{
    capabilities.catalogOnly = true;
    actions.apply.mockResolvedValueOnce({ok:false,errores:["Lost acknowledgement"]});
    render(<CatalogImportForm/>);
    await pasteAndPreview();
    fireEvent.click(screen.getByRole("button",{name:"Confirmar e importar"}));
    await waitFor(()=>expect(actions.apply).toHaveBeenCalledOnce());
    const firstId=(actions.apply.mock.calls[0]![0] as FormData).get("importId");
    await screen.findByText("Lost acknowledgement");
    cleanup();
    render(<CatalogImportForm/>);
    await pasteAndPreview();
    actions.apply.mockResolvedValueOnce({ok:false,errores:["Retry fixture"]});
    fireEvent.click(screen.getByRole("button",{name:"Confirmar e importar"}));
    await waitFor(()=>expect(actions.apply).toHaveBeenCalledTimes(2));
    expect((actions.apply.mock.calls[1]![0] as FormData).get("importId")).toBe(firstId);
    await screen.findByText("Retry fixture");
    cleanup();
    render(<CatalogImportForm/>);
    fireEvent.click(screen.getByRole("checkbox",{name:option}));
    await pasteAndPreview();
    fireEvent.click(screen.getByRole("button",{name:"Confirmar e importar"}));
    await screen.findByText(/Hay otra importación pendiente/);
    expect(actions.apply).toHaveBeenCalledTimes(2);
  });
  it.each([false,true])("resumes a legacy stored identity with overwrite=%s without changing storage",async(overwrite)=>{
    capabilities.catalogOnly=true;
    const digest=await webcrypto.subtle.digest("SHA-256",new TextEncoder().encode(csv));
    const rawHash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
    const legacy={id:"11111111-1111-4111-8111-111111111111",fingerprint:rawHash+":"+String(overwrite)};
    sessionStorage.setItem("catalog-import-v1",JSON.stringify(legacy));
    actions.apply.mockResolvedValue({ok:false,errores:["Legacy retry"]});
    render(<CatalogImportForm/>);
    if(overwrite)fireEvent.click(screen.getByRole("checkbox",{name:/Pisar el stock/}));
    await pasteAndPreview();
    fireEvent.click(screen.getByRole("button",{name:"Confirmar e importar"}));
    await screen.findByText("Legacy retry");
    expect((actions.apply.mock.calls[0]![0] as FormData).get("importId")).toBe(legacy.id);
    expect(sessionStorage.getItem("catalog-import-v1")).toBe(JSON.stringify(legacy));
    cleanup();
    render(<CatalogImportForm/>);
    if(overwrite)fireEvent.click(screen.getByRole("checkbox",{name:/Pisar el stock/}));
    fireEvent.click(screen.getByRole("checkbox",{name:/Preparar y publicar/}));
    await pasteAndPreview();
    fireEvent.click(screen.getByRole("button",{name:"Confirmar e importar"}));
    await screen.findByText(/Hay otra importación pendiente/);
    expect(actions.apply).toHaveBeenCalledOnce();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    capabilities.catalogOnly = false;
    sessionStorage.clear();
    vi.stubGlobal("crypto",webcrypto);
    Object.defineProperty(File.prototype,"arrayBuffer",{configurable:true,value:function(){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsArrayBuffer(this);});}});
    actions.preview.mockResolvedValue({ ok: true, ...summary });
    actions.apply.mockResolvedValue({
      ok: true,
      ...summary,
      variantesEscritas: 1,
      fotosSubidas: 0,
      fotosOmitidas: 0,
      fotosFallidas: [],
    });
  });
  afterEach(cleanup);

  it("previews and confirms the exact CSV through the existing File flow with stock overwrite off", async () => {
    render(<CatalogImportForm />);
    expect(
      screen.queryByRole("button", { name: "Confirmar e importar" })
    ).not.toBeInTheDocument();
    await pasteAndPreview();
    expect(actions.apply).not.toHaveBeenCalled();
    const preview = actions.preview.mock.calls[0]![0] as FormData;
    const file = preview.get("file") as File;
    expect(file.name).toBe("catalogo.csv");
    expect(file.type).toBe("text/csv");
    expect(await readFile(file)).toBe(csv);
    expect(preview.get("pisarStock")).toBe("false");
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar e importar" })
    );
    await waitFor(() => expect(actions.apply).toHaveBeenCalledOnce());
    const applied = actions.apply.mock.calls[0]![0] as FormData;
    expect(await readFile(applied.get("file") as File)).toBe(csv);
    expect(applied.get("pisarStock")).toBe("false");
  });

  it("invalidates the prior preview when pasted content changes or source switches", async () => {
    render(<CatalogImportForm />);
    await pasteAndPreview();
    fireEvent.change(screen.getByLabelText("Contenido CSV"), {
      target: { value: csv + "D2,Otro,Texto" },
    });
    expect(
      screen.queryByRole("button", { name: "Confirmar e importar" })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await screen.findByRole("button", { name: "Confirmar e importar" });
    fireEvent.click(screen.getByLabelText("Subir archivo"));
    expect(
      screen.queryByRole("button", { name: "Confirmar e importar" })
    ).not.toBeInTheDocument();
    expect(actions.apply).not.toHaveBeenCalled();
  });

  it("retains file upload and rejects empty pasted input before preview", async () => {
    render(<CatalogImportForm />);
    const upload = screen.getByLabelText("Cargar planilla");
    const file = new File([csv], "original.csv", { type: "text/csv" });
    fireEvent.change(upload, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await screen.findByRole("button", { name: "Confirmar e importar" });
    expect(await readFile(actions.preview.mock.calls[0]![0].get("file"))).toBe(
      csv
    );
    fireEvent.click(screen.getByLabelText("Pegar CSV"));
    expect(screen.getByRole("button", { name: "Revisar" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Confirmar e importar" })
    ).not.toBeInTheDocument();
  });
});
