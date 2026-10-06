"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { sugerirProductos } from "@/app/actions/search-suggest";
import type { SearchSuggestion } from "@/db/queries";
import { t } from "@/i18n/client";
import { Input } from "@/components/ui/input";

/** Lo que se espera a que la persona deje de tipear antes de consultar. */
const DEBOUNCE_MS = 250;

/**
 * El buscador del header, con sugerencias mientras se escribe (PR N).
 *
 * **Sigue siendo un `<form method="get" action="/buscar">`**, y eso no es un
 * detalle: sin JavaScript —o mientras el bundle todavía baja, que en una 3G
 * paraguaya es un rato— escribir y apretar Enter lleva igual a `/buscar?q=…`.
 * Las sugerencias son una mejora encima de algo que ya funciona, nunca el
 * único camino.
 *
 * El `onSubmit` sólo existe para navegar del lado del cliente (más rápido) y
 * para cerrar la lista; si no corre, el navegador hace exactamente lo mismo
 * con el `action`.
 */
export function SearchBox({ className }: { className?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(params.get("q") ?? "");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const cleaned = term.trim();
  const buscable = cleaned.length >= 2;

  useEffect(() => {
    /*
      El corte por término corto va adentro del timeout y no arriba del efecto,
      aunque ahí se leería mejor: un `setState` síncrono en el cuerpo de un
      efecto provoca un render en cascada y la regla `set-state-in-effect` de
      React lo marca. Adentro del callback ya es asíncrono, que es lo mismo que
      hace la rama con resultados.

      `cancelado` y no un AbortController: una server action no se cancela. Lo
      que se evita es el bug clásico del typeahead — la respuesta de "rem"
      llegando después de la de "remera" y pisando la lista con resultados de
      un término que ya no está escrito.
    */
    let cancelado = false;
    const timer = setTimeout(async () => {
      const rows = buscable ? await sugerirProductos(cleaned) : [];
      if (cancelado) return;
      setSuggestions(rows);
      setHighlighted(-1);
    }, DEBOUNCE_MS);

    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [cleaned, buscable]);

  // Un clic afuera cierra la lista. En el celular es el gesto natural para
  // "no era esto".
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const buscar = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length < 2) return;
    setOpen(false);
    router.push(`/buscar?q=${encodeURIComponent(trimmed)}`);
  };

  const irA = (slug: string): void => {
    setOpen(false);
    router.push(`/producto/${slug}`);
  };

  // También se mira `buscable`: entre que alguien borra hasta dejar una letra
  // y que el efecto limpie la lista pasa un debounce, y en ese rato las
  // sugerencias viejas no tienen nada que ver con lo que dice el campo.
  const visibles = open && buscable && suggestions.length > 0;

  return (
    <div ref={containerRef} className={className}>
      <form
        role="search"
        method="get"
        action="/buscar"
        onSubmit={(event) => {
          event.preventDefault();
          // Con una sugerencia marcada con las flechas, Enter va a esa ficha:
          // es lo que la persona está mirando.
          if (highlighted >= 0 && suggestions[highlighted]) {
            irA(suggestions[highlighted]!.slug);
            return;
          }
          buscar(term);
        }}
      >
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            name="q"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (!visibles) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlighted((index) => (index + 1) % suggestions.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlighted((index) =>
                  index <= 0 ? suggestions.length - 1 : index - 1
                );
              } else if (event.key === "Escape") {
                setOpen(false);
                setHighlighted(-1);
              }
            }}
            placeholder={t("header.buscar.placeholder")}
            aria-label={t("header.buscar.label")}
            role="combobox"
            aria-expanded={visibles}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              highlighted >= 0 ? `${listId}-${highlighted}` : undefined
            }
            autoComplete="off"
            className="pl-9"
          />

          {visibles ? (
            <ul
              id={listId}
              role="listbox"
              aria-label={t("header.buscar.sugerencias")}
              className="border-border bg-background absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border shadow-lg"
            >
              {suggestions.map((item, index) => (
                <li key={item.slug}>
                  <button
                    type="button"
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === highlighted}
                    // `onMouseDown` y no `onClick`: el blur del input dispara
                    // antes que el click y cerraría la lista debajo del dedo.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      irA(item.slug);
                    }}
                    onMouseEnter={() => setHighlighted(index)}
                    className={`hover:bg-muted flex w-full flex-col items-start px-3 py-2 text-left text-sm ${
                      index === highlighted ? "bg-muted" : ""
                    }`}
                  >
                    <span>{item.name}</span>
                    {item.brand ? (
                      <span className="text-muted-foreground text-xs">
                        {item.brand}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
              <li className="border-border border-t">
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    buscar(term);
                  }}
                  className="hover:bg-muted text-muted-foreground w-full px-3 py-2 text-left text-xs"
                >
                  {t("header.buscar.verTodos", { termino: cleaned })}
                </button>
              </li>
            </ul>
          ) : null}
        </div>
      </form>
    </div>
  );
}
