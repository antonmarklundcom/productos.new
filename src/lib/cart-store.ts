"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { revalidateCart } from "@/app/actions/cart";
import type { FreeShippingProgress } from "@/domain/free-shipping";
import type { CartIssue } from "@/lib/cart-issues";

/**
 * Carrito del navegador.
 *
 * Es una **lista de deseos**, no una fuente de verdad: `unitPricePyg` y
 * `name` están sólo para poder dibujar el carrito sin ir al servidor en cada
 * render. Antes de cobrar, el servidor vuelve a leer precio y stock de la DB
 * (ver `revalidateCart` y README.md, "El navegador nunca decide precios").
 */
export type CartLine = {
  variantId: number;
  qty: number;
  /** Snapshot sólo para mostrar. */
  productSlug: string;
  name: string;
  variantLabel: string;
  unitPricePyg: number;
  /**
   * El SKU, para los eventos de medición (`src/lib/funnel.ts`): Meta y Google
   * cruzan el evento con el catálogo del feed por este id (`g:id`). Opcional:
   * un carrito guardado antes de que existiera no lo tiene hasta el próximo
   * `sync`.
   */
  sku?: string;
};

export type CartState = {
  lines: CartLine[];
  isOpen: boolean;
  /** Diferencias que encontró el servidor en la última revalidación. */
  issues: CartIssue[];
  /**
   * Progreso hacia el envío gratis, calculado en el servidor contra
   * `shipping_zones`. `null` hasta la primera revalidación: sin dato no se
   * dibuja nada, que es mejor que dibujar un umbral inventado.
   */
  freeShipping: FreeShippingProgress | null;
  isSyncing: boolean;
  add: (line: Omit<CartLine, "qty">, qty?: number) => void;
  setQty: (variantId: number, qty: number) => void;
  remove: (variantId: number) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
  /**
   * Revalida contra el servidor y reemplaza los snapshots por lo que dice la
   * DB. Vive en el store, no en un `useEffect`: así el estado se actualiza
   * desde una acción del usuario (abrir el carrito, agregar algo) y no desde
   * un efecto que dispara renders en cascada.
   */
  sync: () => Promise<void>;
};

export const CART_STORAGE_KEY = "tienda-py-cart";
export const CART_STORAGE_VERSION = 1;
export const MAX_QTY_PER_LINE = 99;

/**
 * Migración de carritos viejos. La v0 (pre-variantes) guardaba `productId` y
 * no se puede mapear a una variante sin ir a la DB: se descarta en vez de
 * inventar una. Un carrito vacío molesta menos que uno que cobra otra cosa.
 */
export function migrateCart(persisted: unknown, version: number): { lines: CartLine[] } {
  if (version >= CART_STORAGE_VERSION && persisted && typeof persisted === "object") {
    const lines = (persisted as { lines?: unknown }).lines;
    if (Array.isArray(lines)) {
      return { lines: lines.filter(isCartLine) };
    }
  }
  return { lines: [] };
}

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Partial<CartLine>;
  return (
    Number.isInteger(line.variantId) &&
    Number.isInteger(line.qty) &&
    (line.qty ?? 0) > 0 &&
    typeof line.name === "string" &&
    Number.isInteger(line.unitPricePyg)
  );
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      isOpen: false,
      issues: [],
      freeShipping: null,
      isSyncing: false,

      add: (line, qty = 1) =>
        set((state) => {
          const existing = state.lines.find((item) => item.variantId === line.variantId);
          if (existing) {
            return {
              lines: state.lines.map((item) =>
                item.variantId === line.variantId
                  ? { ...item, ...line, qty: Math.min(MAX_QTY_PER_LINE, item.qty + qty) }
                  : item
              ),
              isOpen: true,
            };
          }
          return {
            lines: [...state.lines, { ...line, qty: Math.min(MAX_QTY_PER_LINE, qty) }],
            isOpen: true,
          };
        }),

      setQty: (variantId, qty) =>
        set((state) => ({
          lines:
            qty <= 0
              ? state.lines.filter((item) => item.variantId !== variantId)
              : state.lines.map((item) =>
                  item.variantId === variantId
                    ? { ...item, qty: Math.min(MAX_QTY_PER_LINE, qty) }
                    : item
                ),
        })),

      remove: (variantId) =>
        set((state) => ({ lines: state.lines.filter((item) => item.variantId !== variantId) })),

      clear: () => set({ lines: [], issues: [], freeShipping: null }),

      open: () => {
        set({ isOpen: true });
        void get().sync();
      },

      close: () => set({ isOpen: false }),

      sync: async () => {
        const { lines } = get();
        if (lines.length === 0) {
          set({ issues: [], freeShipping: null, isSyncing: false });
          return;
        }

        set({ isSyncing: true });
        try {
          const priced = await revalidateCart(
            lines.map((line) => ({
              variantId: line.variantId,
              qty: line.qty,
              unitPricePyg: line.unitPricePyg,
            }))
          );
          set({
            lines: priced.lines.map<CartLine>((line) => ({
              variantId: line.variantId,
              qty: line.qty,
              productSlug: line.productSlug,
              name: line.name,
              variantLabel: line.variantLabel,
              unitPricePyg: line.unitPricePyg,
              sku: line.sku,
            })),
            issues: priced.issues,
            freeShipping: priced.freeShipping,
          });
        } catch {
          // Sin red: seguimos con los snapshots del navegador. El checkout
          // vuelve a validar de todos modos, así que no se cobra de más.
        } finally {
          set({ isSyncing: false });
        }
      },
    }),
    {
      name: CART_STORAGE_KEY,
      version: CART_STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // `isOpen` es estado de UI: si se persistiera, el carrito se abriría
      // solo al entrar al sitio.
      partialize: (state) => ({ lines: state.lines }),
      migrate: migrateCart,
    }
  )
);

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + line.qty, 0);
}

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + line.unitPricePyg * line.qty, 0);
}
