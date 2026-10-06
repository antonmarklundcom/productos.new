"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Favoritos del navegador, igual que el carrito y "vistos recientemente".
 *
 * Sin cuentas de cliente (apagadas por defecto, `TIENDA.cuentasClientes`), no
 * hay dónde guardar una lista de deseos del lado del servidor — así que vive
 * en `localStorage`, igual que el carrito. Guarda sólo el **slug** de cada
 * producto: nada de nombre ni precio acá, porque a diferencia del carrito
 * (que necesita dibujarse sin ir al servidor) esta lista siempre se resuelve
 * contra la DB antes de mostrarse (`/favoritos`, `getWishlistProducts`), así
 * que un precio viejo guardado en el navegador no tiene ningún uso.
 */

export const WISHLIST_STORAGE_KEY = "tienda-py-favoritos";
export const WISHLIST_STORAGE_VERSION = 1;
export const MAX_WISHLIST_ITEMS = 50;

type WishlistState = {
  slugs: string[];
  /** Agrega o saca el slug. Devuelve `true` si quedó guardado. */
  toggle: (slug: string) => boolean;
  /**
   * Agrega varios de una — "Guardar todos en mis favoritos" al ver una lista
   * compartida (`/favoritos?p=`). A diferencia de `toggle`, nunca saca nada:
   * ver una lista ajena no puede vaciar la propia.
   */
  addMany: (slugs: string[]) => void;
};

function isSlug(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Migración de listas viejas: cualquier entrada que no sea un string no
 * vacío se descarta en vez de intentar arreglarla — una lista más corta
 * molesta menos que un `undefined` colándose en el grid de `/favoritos`.
 */
export function migrateWishlist(persisted: unknown, version: number): { slugs: string[] } {
  if (version >= WISHLIST_STORAGE_VERSION && persisted && typeof persisted === "object") {
    const slugs = (persisted as { slugs?: unknown }).slugs;
    if (Array.isArray(slugs)) {
      return { slugs: slugs.filter(isSlug).slice(0, MAX_WISHLIST_ITEMS) };
    }
  }
  return { slugs: [] };
}

export const useWishlist = create<WishlistState>()(
  persist(
    (set, get) => ({
      slugs: [],

      toggle: (slug) => {
        const alreadyThere = get().slugs.includes(slug);
        if (alreadyThere) {
          set((state) => ({ slugs: state.slugs.filter((item) => item !== slug) }));
          return false;
        }
        // Más nuevo primero, tope de MAX_WISHLIST_ITEMS: mismo criterio que
        // "vistos recientemente" — es una lista de la compradora, no un
        // archivo, y no hace falta guardar más de lo que se va a mostrar.
        set((state) => ({ slugs: [slug, ...state.slugs].slice(0, MAX_WISHLIST_ITEMS) }));
        return true;
      },

      addMany: (slugs) =>
        set((state) => {
          const nuevos = slugs.filter((slug) => !state.slugs.includes(slug));
          if (nuevos.length === 0) return state;
          return { slugs: [...nuevos, ...state.slugs].slice(0, MAX_WISHLIST_ITEMS) };
        }),
    }),
    {
      name: WISHLIST_STORAGE_KEY,
      version: WISHLIST_STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: migrateWishlist,
    }
  )
);

/** `list()`: los slugs guardados, más nuevo primero. */
export function wishlistList(): string[] {
  return useWishlist.getState().slugs;
}

/** `has()`: ¿este producto está en favoritos? */
export function wishlistHas(slug: string): boolean {
  return useWishlist.getState().slugs.includes(slug);
}

/** `toggle()`: agrega o saca. Devuelve `true` si quedó guardado. */
export function wishlistToggle(slug: string): boolean {
  return useWishlist.getState().toggle(slug);
}

/** `subscribe()`: para `useSyncExternalStore`, igual que `useCart.subscribe`. */
export const wishlistSubscribe = (listener: () => void) => useWishlist.subscribe(listener);

export function wishlistCount(slugs: string[]): number {
  return slugs.length;
}
