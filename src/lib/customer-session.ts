import { hkdfSync } from "node:crypto";

import {
  getIronSession,
  type IronSession,
  type SessionOptions,
} from "iron-session";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { customers } from "@/db/schema";
import { validSessionSecret } from "./session-secret";

/**
 * Sesión de **cliente** — separada de la del panel, a propósito y en todo.
 *
 * Guardarraíl 4 del PLAN.md, y no es paranoia de manual: si compradoras y
 * empleados compartieran cookie, un bug de rol convierte a una clienta en
 * staff. Acá no hay ningún camino entre las dos sesiones.
 *
 * | | Panel | Cliente |
 * |---|---|---|
 * | Cookie | `ecom_admin` | `ecom_cliente` |
 * | Secreto | `SESSION_SECRET` | `CUSTOMER_SESSION_SECRET` |
 * | Tabla | `users` | `customers` |
 * | Guard | `requireAdminSession` | `requireCustomerSession` |
 *
 * **El secreto es propio.** Reusar `SESSION_SECRET` haría que una cookie de
 * cliente forjada con ese secreto la pudiera desencriptar el lado del panel:
 * el contenido no coincidiría con lo que espera `requireAdmin` y hoy no
 * pasaría nada, pero es exactamente el tipo de "hoy no pasa nada" que deja de
 * ser cierto con el próximo campo que se agregue. Dos secretos, cero
 * razonamiento.
 *
 * **Ya no hace falta cargarlo en el hosting.** Si `CUSTOMER_SESSION_SECRET`
 * está vacío, se **deriva** de `SESSION_SECRET` con HKDF-SHA256 y un contexto
 * propio: es otro secreto (conocer uno no da el otro, y ninguna cookie del
 * panel abre con él), sin que nadie tenga que generarlo ni pegarlo en el
 * hPanel. Así las cuentas de cliente se prenden desde `/admin/ajustes` y
 * listo. Una tienda que ya tiene la variable cargada sigue usando la suya.
 */
export type CustomerSession = {
  customerId?: number;
  /** `+595XXXXXXXXX`. Sólo para mostrar; la autorización es por `customerId`. */
  phone?: string;
  name?: string;
  sessionVersion?: number;
};

export const CUSTOMER_SESSION_COOKIE = "ecom_cliente";

/**
 * El secreto de la sesión de cliente: `CUSTOMER_SESSION_SECRET` si está, o
 * uno derivado de `SESSION_SECRET` (ver arriba). `null` si no hay forma:
 * variable propia de menos de 32, o `SESSION_SECRET` ausente, corto o el
 * placeholder de `.env.example`.
 */
export function secretoSesionCliente(
  env: Record<string, string | undefined> = process.env
): string | null {
  const propio = (env.CUSTOMER_SESSION_SECRET ?? "").trim();
  if (propio !== "")
    return validSessionSecret(propio) && propio !== env.SESSION_SECRET
      ? propio
      : null;

  const base = (env.SESSION_SECRET ?? "").trim();
  if (!validSessionSecret(base)) return null;
  // 32 bytes → 43 caracteres base64url: más que el mínimo de iron-session.
  return Buffer.from(
    hkdfSync(
      "sha256",
      base,
      "ecom/customer-session/v1",
      "iron-session:ecom_cliente",
      32
    )
  ).toString("base64url");
}

export function customerSessionOptions(): SessionOptions {
  const password = secretoSesionCliente();
  if (!password) {
    throw new Error(
      "No hay secreto para la sesión de cliente: SESSION_SECRET falta o es inválido (de ahí " +
        "se deriva), o CUSTOMER_SESSION_SECRET está cargado con menos de 32 caracteres."
    );
  }
  return {
    password,
    cookieName: CUSTOMER_SESSION_COOKIE,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      // 30 días: del otro lado no hay plata del comercio ni datos de terceros,
      // sólo los pedidos de quien entra. La del panel dura 8 horas porque abre
      // la caja; ésta se comporta como lo que es, la comodidad de no volver a
      // tipear la dirección.
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}

/** ¿Está configurado el secreto? Sin él, la feature no se puede ofrecer. */
export function customerSessionConfigured(): boolean {
  return secretoSesionCliente() !== null;
}

export async function getCustomerSession(): Promise<
  IronSession<CustomerSession>
> {
  const cookieStore = await cookies();
  return getIronSession<CustomerSession>(cookieStore, customerSessionOptions());
}

export class CustomerUnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Entrá a tu cuenta para ver esto") {
    super(message);
    this.name = "CustomerUnauthorizedError";
  }
}

export type CustomerActor = { customerId: number; phone: string; name: string };

/**
 * Guard de toda acción y página de `/cuenta`.
 *
 * Mismo razonamiento que `requireAdminSession`: una server action es un
 * endpoint HTTP con su propio id y se la puede invocar sin pasar por ninguna
 * URL. Esconder la pantalla no es el control de acceso.
 */
export async function requireCustomerSession(): Promise<CustomerActor> {
  const session = await getCustomerSession();
  return validateCustomerSession(session);
}
export async function validateCustomerSession(
  session: Partial<CustomerSession>
): Promise<CustomerActor> {
  if (!session.customerId || !session.phone || !session.name) {
    throw new CustomerUnauthorizedError();
  }
  const [customer] = await getDb()
    .select()
    .from(customers)
    .where(eq(customers.id, session.customerId))
    .limit(1);
  if (
    !customer?.isActive ||
    session.sessionVersion !== customer.sessionVersion
  ) {
    throw new CustomerUnauthorizedError();
  }
  return {
    customerId: customer.id,
    phone: customer.phone,
    name: customer.name,
  };
}

/** La sesión si la hay, sin tirar. Para prefills y para el header. */
export async function currentCustomer(): Promise<CustomerActor | null> {
  if (!customerSessionConfigured()) return null;
  try {
    return await requireCustomerSession();
  } catch {
    return null;
  }
}

export async function destroyCustomerSession(): Promise<void> {
  const session = await getCustomerSession();
  session.destroy();
}
