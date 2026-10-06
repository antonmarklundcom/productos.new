import { safeError } from "@/lib/safe-error";
import { redirect } from "next/navigation";

import { t } from "@/i18n";
import { can, type Capability } from "@/lib/permissions";
import { validateAdminSession } from "./session-validation";
import {
  ForbiddenError,
  UnauthorizedError,
  actorLabel,
  assertCanTransitionTo,
  getSession,
  requireOwner,
  requireStaff,
  type AdminActor,
} from "@/lib/session";

/**
 * El guard que abre **toda** server action de `/admin` (ARCH.md §1, regla 2).
 *
 * El middleware que protege `/admin/*` mira la cookie y nada más: es un
 * atajo de UX para redirigir al login, no una defensa. Las server actions son
 * endpoints HTTP con su propio id — cualquiera con ese id las puede invocar
 * con un `fetch` sin pasar jamás por una ruta `/admin`, así que el middleware
 * ni se entera. Por eso la sesión se relee y el rol se re-chequea acá adentro,
 * en cada acción, contra la cookie firmada.
 *
 * Lanza `UnauthorizedError` / `ForbiddenError`; quien llama las traduce a un
 * resultado para el formulario (ver `adminActionError`).
 */
export async function requireAdminSession(): Promise<AdminActor> {
  return validateAdminSession(await getSession());
}

/**
 * Igual, para la operación diaria: plata, stock, productos, comprobantes.
 * Pasan `owner` y `staff`; el `vendedor` no (ver la matriz de ARCH.md §1).
 */
export async function requireStaffSession(): Promise<AdminActor> {
  const actor = await requireAdminSession();
  return requireStaff(actor);
}

/** Igual, para lo que sólo puede hacer el dueño (altas de usuario, borrados). */
export async function requireOwnerSession(): Promise<AdminActor> {
  const actor = await requireAdminSession();
  return requireOwner(actor);
}

/** `admin:due@tienda.py` — lo que queda escrito en `order_events.actor`. */
export { actorLabel };

/**
 * El permiso de transición, por rol. No es un guard de módulo porque
 * `advanceOrder` es la misma acción para los tres roles y lo que cambia es el
 * destino — ver `assertCanTransitionTo` en `session.ts`.
 */
export { assertCanTransitionTo };

/**
 * El rol de quien está mirando, para decidir qué dibujar.
 *
 * Sólo para páginas: una página del panel ya corre detrás del layout con
 * guard, y lo que necesita de la sesión es el rol, no un permiso. Una server
 * action **no** usa esto — usa su guard, que además tira.
 */
export async function adminActor(): Promise<AdminActor> {
  return requireAdminSession();
}

/**
 * Guard de página por capacidad: la pantalla que un rol no puede ver, no se
 * dibuja.
 *
 * Es UX —lo que frena una escritura es el guard de la acción— pero evita el
 * caso feo de una pantalla a medio dibujar con todos los botones apagados, y
 * el peor: una lista de precios renderizada para quien no tiene que verla.
 *
 * Redirige a `/admin/pedidos` en vez de tirar: es la única pantalla que los
 * tres roles pueden abrir, así que siempre es un destino válido. Un error
 * 403 acá sería correcto y también inútil — quien llegó por el link de otro
 * no hizo nada malo.
 */
export async function requireCapabilityPage(
  capability: Capability
): Promise<AdminActor> {
  const actor = await adminActor();
  if (!can(actor.role, capability)) redirect("/admin/pedidos");
  return actor;
}

/**
 * Lo que devuelve una acción de admin al formulario. `T` son los datos extra
 * del caso exitoso (`unknown` por defecto: intersectarlo no agrega nada).
 */
export type AdminActionResult<T = unknown> =
  ({ ok: true } & T) | { ok: false; error: string };

/**
 * Traduce el error de una acción de admin a algo que el formulario pueda
 * mostrar.
 *
 * Los errores de dominio (`InvalidTransitionError`, `ReceiptError`) tienen
 * mensajes escritos para el dueño y se muestran tal cual. Cualquier otra cosa
 * —un error de MySQL, un timeout de Cloudinary— sale como un mensaje genérico
 * y el detalle queda en el log del servidor: un stack trace en pantalla es una
 * filtración de la estructura interna, y al dueño no le sirve de nada.
 */
export function adminActionError(
  context: string,
  error: unknown
): { ok: false; error: string } {
  if (error instanceof UnauthorizedError) {
    return { ok: false, error: t("adminError.sesionCerrada") };
  }
  if (error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof Error && KNOWN_DOMAIN_ERRORS.includes(error.name)) {
    return { ok: false, error: error.message };
  }
  console.error(`${context} falló`, safeError(error).message);
  return { ok: false, error: t("adminError.generico") };
}

const KNOWN_DOMAIN_ERRORS = [
  "OperationKeyReusedError",
  "InvalidTransitionError",
  "OrderNotFoundError",
  "ReceiptError",
  "InsufficientStockError",
  "StockUnavailableError",
  "PaymentRecoveryError",
  "MoneyError",
  "AdminInputError",
  "AdminBankError",
  "AdminShippingMethodError",
  // O5: la nota vacía, el pedido que no existe y el usuario desactivado
  // tienen mensajes escritos para quien está en el mostrador.
  "OrderNoteError",
  "TrackingNotAllowedError",
  // Reseñas: "esa reseña ya no existe", "la respuesta es muy larga".
  "ReviewError",
  // Devoluciones: "de esa línea se pueden devolver 1 como máximo".
  "ReturnError",
  // Ajustes de la tienda: "el link tiene que empezar con https://".
  "StoreSettingsError",
  // Integraciones: "el ID de GA4 tiene la forma G-…", "falta SESSION_SECRET".
  "IntegracionError",
];
