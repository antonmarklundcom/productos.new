/**
 * Diferencias entre lo que muestra el navegador y lo que dice la DB.
 *
 * Vive en `lib/` y no en `domain/cart.ts` a propósito: el carrito del cliente
 * necesita el tipo y el texto, y `domain/cart` importa el pool de MySQL. Sin
 * esta separación, `mysql2` termina en el bundle del navegador (el build lo
 * corta, pero recién al final).
 */
import { t } from "@/i18n/client";

export type CartIssue =
  | { type: "no_disponible"; variantId: number; name: string }
  | { type: "solo_consulta"; variantId: number; name: string }
  | {
      type: "stock_parcial";
      variantId: number;
      name: string;
      requested: number;
      available: number;
    }
  | {
      type: "precio_cambio";
      variantId: number;
      name: string;
      before: number;
      after: number;
    };

/** El problema, contado en el idioma de la tienda. */
export function describeIssue(issue: CartIssue): string {
  switch (issue.type) {
    case "solo_consulta":
      return t("carrito.problema.soloConsulta", { nombre: issue.name });
    case "no_disponible":
      return t("carrito.problema.noDisponible", { nombre: issue.name });
    case "stock_parcial":
      return t("carrito.problema.stockParcial", {
        nombre: issue.name,
        disponible: issue.available,
        pedido: issue.requested,
      });
    case "precio_cambio":
      return t("carrito.problema.precioCambio", { nombre: issue.name });
  }
}
