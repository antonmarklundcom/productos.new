"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { authenticate } from "@/lib/auth";
import {
  LOGIN_LIMIT,
  LOGIN_WINDOW_MS,
  clientIp,
  rateLimit,
  resetRateLimitKey,
} from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/safe-redirect";
import { getSession } from "@/lib/session";
import { t, tPlural } from "@/i18n";

/**
 * Login del panel (PLAN.md 4.1).
 *
 * No hay ruta pública de registro: el usuario se crea con
 * `pnpm create-owner`. Esta acción sólo verifica credenciales existentes.
 */

/** Un único mensaje para "no existe", "contraseña incorrecta" y "usuario inactivo". */
/** Función y no constante: `t()` se resuelve al importar el módulo. */
const genericError = (): string => t("adminError.login.generico");

const LoginSchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
  /** A dónde volver después de entrar. Se valida antes de usarse. */
  next: z.string().optional(),
});

/** Sólo se devuelve en el fallo: si entra, la acción redirige y no vuelve. */
export type LoginResult = { ok: false; error: string };

export async function loginAdmin(formData: FormData): Promise<LoginResult> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: genericError() };
  }

  // Fuerza bruta: el límite es por IP **y** por email, porque el atacante
  // controla las dos cosas por separado — una botnet rota la IP contra un solo
  // email, y un scanner rota emails desde una sola IP.
  const ip = clientIp(await headers());
  const email = parsed.data.email.toLowerCase();
  const options = { limit: LOGIN_LIMIT, windowMs: LOGIN_WINDOW_MS };
  const byIp = rateLimit(`login:ip:${ip}`, options);
  const byEmail = rateLimit(`login:email:${email}`, options);

  if (!byIp.ok || !byEmail.ok) {
    const seconds = Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds);
    const minutes = Math.ceil(seconds / 60);
    return {
      ok: false,
      error: tPlural("adminError.login.demasiados", minutes),
    };
  }

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) {
    return { ok: false, error: genericError() };
  }

  // Entró: se le devuelven los intentos para que un login legítimo después de
  // varios tipeos mal no quede bloqueado.
  resetRateLimitKey(`login:ip:${ip}`);
  resetRateLimitKey(`login:email:${email}`);

  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.role = user.role;
  session.sessionVersion = user.sessionVersion;
  await session.save();

  redirect(safeNextPath(parsed.data.next));
}

export async function logoutAdmin(): Promise<void> {
  const session = await getSession();
  session.destroy();
  redirect("/admin/login");
}
