import {
  getIronSession,
  type IronSession,
  type SessionOptions,
} from "iron-session";
import { cookies } from "next/headers";

import type { OrderStatus } from "@/db/schema";
import { USER_ROLES, type UserRole } from "@/lib/roles";
import { validSessionSecret } from "./session-secret";

/**
 * Sesión de admin. No hay cuentas de comprador en v1: el comprador entra a su
 * pedido con el token de la URL (ARCH.md §1).
 */
export type AdminSession = {
  userId?: number;
  email?: string;
  role?: UserRole;
  sessionVersion?: number;
};

export const SESSION_COOKIE = "ecom_admin";

export function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!validSessionSecret(password)) {
    throw new Error(
      "SESSION_SECRET debe existir y tener al menos 32 caracteres. " +
        "Generala con: openssl rand -base64 32"
    );
  }
  return {
    password,
    cookieName: SESSION_COOKIE,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    },
  };
}

export async function getSession(): Promise<IronSession<AdminSession>> {
  const cookieStore = await cookies();
  return getIronSession<AdminSession>(cookieStore, sessionOptions());
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Necesitás iniciar sesión") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "No tenés permiso para hacer esto") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export type AdminActor = { userId: number; email: string; role: UserRole };

/**
 * Guard de admin. Se llama al principio de CADA server action y route handler
 * de `/admin` — esconder un botón es UX, no seguridad (ARCH.md §1, regla 2).
 */
export function requireAdmin(
  session: AdminSession | null | undefined
): AdminActor {
  if (!session?.userId || !session.email || !session.role) {
    throw new UnauthorizedError();
  }
  // Contra la lista del ENUM y no contra un par de literales: el día que se
  // agregue un rol, olvidarse de esta línea lo dejaría afuera del panel entero
  // con un 403 sin explicación. Lo que sigue afuera es cualquier cosa que no
  // sea un rol del panel — una cookie vieja, una sesión de cliente (PR E).
  if (!USER_ROLES.includes(session.role)) {
    throw new ForbiddenError();
  }
  return { userId: session.userId, email: session.email, role: session.role };
}

/**
 * Acciones de la operación diaria: plata, stock, productos, comprobantes.
 *
 * Deja pasar a `owner` y `staff`, y **excluye a `vendedor`**: quien está en el
 * mostrador despacha pedidos, no cambia precios ni aprueba transferencias.
 */
export function requireStaff(
  session: AdminSession | null | undefined
): AdminActor {
  const actor = requireAdmin(session);
  if (actor.role === "vendedor") {
    throw new ForbiddenError(
      "Tu usuario no puede hacer esto. Pedíselo al dueño o al encargado."
    );
  }
  return actor;
}

/** Acciones reservadas al dueño (alta de usuarios, borrados, reembolsos). */
export function requireOwner(
  session: AdminSession | null | undefined
): AdminActor {
  const actor = requireAdmin(session);
  if (actor.role !== "owner") {
    throw new ForbiddenError("Sólo el dueño puede hacer esto");
  }
  return actor;
}

/**
 * Los estados a los que un `vendedor` puede mover un pedido.
 *
 * El plan lo escribe como "sólo `pagado → enviado → entregado`". La máquina de
 * estados real (ARCH.md §3) pasa obligatoriamente por `preparando` entre
 * `pagado` y `enviado`, así que los tres destinos del despacho están acá: sin
 * `preparando` el rol no podría completar ni una sola vez el camino que el
 * plan le asigna.
 *
 * Lo que queda afuera es todo lo demás, y es lo importante: `pagado` (dar por
 * cobrada una transferencia), `reembolsado`, `cancelado`, `rechazado` y
 * `vencido` mueven plata o sueltan stock, y ninguno es trabajo de mostrador.
 */
export const VENDEDOR_TRANSITIONS: readonly OrderStatus[] = [
  "preparando",
  "enviado",
  "entregado",
];

/**
 * Guard de la transición, por rol.
 *
 * `advanceOrder` no se puede resolver con un guard de módulo: es la **misma**
 * acción para los tres roles y lo que cambia es el destino. Owner y staff
 * mueven el pedido a donde la máquina de estados permita; el vendedor, sólo
 * dentro del despacho.
 *
 * `transitionOrder()` sigue validando la arista después: esto decide quién
 * tiene permiso, no si la transición existe.
 */
export function assertCanTransitionTo(
  actor: AdminActor,
  to: OrderStatus
): void {
  if (actor.role !== "vendedor") return;
  if (!VENDEDOR_TRANSITIONS.includes(to)) {
    throw new ForbiddenError(
      "Tu usuario sólo puede preparar, despachar y dar por entregado un pedido."
    );
  }
}

/** Etiqueta de actor para `order_events`. */
export function actorLabel(actor: AdminActor): string {
  return `admin:${actor.email}`;
}
