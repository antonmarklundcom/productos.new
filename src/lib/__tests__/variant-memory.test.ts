import { beforeEach, describe, expect, it, vi } from "vitest";

import { recallVariant, rememberVariant } from "@/lib/variant-memory";

/**
 * Memoria de la variante elegida.
 *
 * Es una comodidad y nada más, así que lo que se prueba es que **falle
 * blandito**: datos basura, localStorage que explota (Safari privado) o una
 * variante que ya no existe tienen que terminar en "no me acuerdo", nunca en
 * un error ni en un id inventado.
 */

describe("recordar la variante", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("guarda y devuelve por producto", () => {
    rememberVariant("remera-azul", 7);
    rememberVariant("gorra-negra", 12);

    expect(recallVariant("remera-azul")).toBe(7);
    expect(recallVariant("gorra-negra")).toBe(12);
    expect(recallVariant("nunca-visto")).toBeNull();
  });

  it("la última elección pisa a la anterior", () => {
    rememberVariant("remera-azul", 7);
    rememberVariant("remera-azul", 8);
    expect(recallVariant("remera-azul")).toBe(8);
  });

  it("descarta lo que no sea un id entero positivo", () => {
    window.localStorage.setItem(
      "tienda-py-variante",
      JSON.stringify({ a: "7", b: -1, c: 1.5, d: null, e: 3 })
    );

    for (const slug of ["a", "b", "c", "d"]) {
      expect(recallVariant(slug)).toBeNull();
    }
    expect(recallVariant("e")).toBe(3);
  });

  it("con basura en localStorage no explota", () => {
    window.localStorage.setItem("tienda-py-variante", "{no es json");
    expect(recallVariant("remera-azul")).toBeNull();
  });

  it("si localStorage tira, se sigue comprando igual", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    expect(() => rememberVariant("remera-azul", 7)).not.toThrow();
    setItem.mockRestore();
  });

  it("no crece para siempre: se queda con las últimas 30", () => {
    for (let i = 1; i <= 35; i += 1) rememberVariant(`producto-${i}`, i);

    const stored = JSON.parse(window.localStorage.getItem("tienda-py-variante") ?? "{}") as Record<
      string,
      number
    >;
    expect(Object.keys(stored)).toHaveLength(30);
    // Se descarta lo más viejo, no lo recién usado.
    expect(recallVariant("producto-35")).toBe(35);
    expect(recallVariant("producto-1")).toBeNull();
  });
});
