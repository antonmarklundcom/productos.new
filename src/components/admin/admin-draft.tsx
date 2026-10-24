"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
const ActorContext = createContext<number | null>(null);
export function AdminDraftScope({
  actorId,
  children,
}: {
  actorId: number;
  children: ReactNode;
}) {
  return (
    <ActorContext.Provider value={actorId}>{children}</ActorContext.Provider>
  );
}
export function clearAdminDrafts() {
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith("admin-draft:")) sessionStorage.removeItem(key);
  } catch {}
}
type Draft = { version: string; values: Array<[string, string]> };
/** Tab-scoped storage, scoped to an edit form. File contents are never stored. */
export function useAdminDraft(key: string, version: unknown) {
  const actorId = useContext(ActorContext);
  const ref = useRef<HTMLFormElement>(null),
    dirty = useRef(false),
    storageKey = "admin-draft:" + (actorId ?? "isolated") + ":" + key;
  const [recovery, setRecovery] = useState<Draft | null>(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) queueMicrotask(() => setRecovery(JSON.parse(raw) as Draft));
    } catch {}
  }, [storageKey]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest("a[href]");
      if (
        dirty.current &&
        anchor &&
        !window.confirm(
          "Tenés cambios sin guardar. El borrador queda en esta pestaña. ¿Salir?"
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, []);
  const saveDraft = () => {
    if (!ref.current) return;
    dirty.current = true;
    const data = new FormData(ref.current),
      values = [...data].filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      );
    // Checkbox absence is meaningful and must also survive reload.
    for (const input of ref.current.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]'
    ))
      if (input.name && !input.checked)
        values.push([input.name, "__unchecked__"]);
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ version: JSON.stringify(version), values })
      );
    } catch {}
  };
  const clear = () => {
    dirty.current = false;
    setRecovery(null);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  };
  const restore = () => {
    if (!recovery || !ref.current) return;
    if (
      recovery.version !== JSON.stringify(version) &&
      !window.confirm(
        "El registro cambió desde este borrador. Compará los valores actuales antes de recuperar. ¿Confirmás que revisaste los cambios y querés usar la versión actual como base?"
      )
    )
      return;
    for (const [name, value] of recovery.values) {
      const element = ref.current.elements.namedItem(name);
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        if (
          element instanceof HTMLInputElement &&
          element.type === "checkbox"
        ) {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "checked"
          )?.set;
          setter?.call(element, value !== "__unchecked__");
        } else {
          const setter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(element),
            "value"
          )?.set;
          setter?.call(element, value);
        }
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    dirty.current = true;
    setRecovery(null);
  };
  return {
    bindForm: (form: HTMLFormElement | null) => {
      ref.current = form;
    },
    onInput: saveDraft,
    clear,
    recovery: recovery ? (
      <div role="status" className="rounded border p-3 text-sm">
        <p>
          Hay un borrador guardado en esta pestaña. Revisá los datos actuales
          antes de recuperarlo.
        </p>
        <button type="button" onClick={restore} className="underline">
          Recuperar borrador
        </button>{" "}
        ·{" "}
        <button type="button" onClick={clear} className="underline">
          Descartar borrador
        </button>
      </div>
    ) : null,
  };
}
