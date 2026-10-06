"use server";

import { safeError } from "@/lib/safe-error";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { cuentasClientesHabilitadas } from "@/lib/cuentas";
import {
  CustomerError,
  authenticateCustomer,
  claimGuestOrder,
  findCustomerById,
  findCustomerByPhone,
  registerCustomer,
  updateCustomerProfile,
} from "@/domain/customers";
import {
  consumeLoginToken,
  issueLoginToken,
  loginCodeMessage,
} from "@/domain/login-tokens";
import { resolveMessageSender } from "@/domain/messaging";
import {
  destroyCustomerSession,
  getCustomerSession,
  requireCustomerSession,
} from "@/lib/customer-session";
import {
  CUSTOMER_LOGIN_LIMIT,
  CUSTOMER_LOGIN_WINDOW_MS,
  CUSTOMER_REGISTER_LIMIT,
  CUSTOMER_REGISTER_WINDOW_MS,
  OTP_REQUEST_LIMIT,
  OTP_REQUEST_WINDOW_MS,
  OTP_VERIFY_LIMIT,
  OTP_VERIFY_WINDOW_MS,
  clientIp,
  rateLimit,
  resetRateLimitKey,
} from "@/lib/rate-limit";
import {
  hashPassword,
  passwordStrengthMessage,
  validatePasswordStrength,
} from "@/lib/password";
import { getDb } from "@/db";
import { customers } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { normalizePhonePY } from "@/lib/py";

/**
 * Acciones de las cuentas de cliente (PLAN.md FASE 2, PR E).
 *
 * Cuatro reglas para todo el archivo:
 *
 * 1. **La primera línea es siempre el flag.** Con `TIENDA.cuentasClientes` en
 *    false estas acciones no existen para nadie. Las páginas devuelven 404,
 *    pero una server action es un endpoint HTTP con su propio id y se la puede
 *    invocar sin pasar por ninguna URL — exactamente el mismo razonamiento que
 *    los guards de `/admin`. Hay un test de CI que verifica que todas empiecen
 *    por acá.
 * 2. **Nada de esto toca el panel.** Cookie propia, secreto propio, tabla
 *    propia (guardarraíl 4 del plan).
 * 3. **El error de login no distingue.** "No existe", "contraseña incorrecta"
 *    y "cuenta desactivada" son el mismo mensaje.
 * 4. **El checkout de invitado no se toca.** Nada de acá es requisito para
 *    comprar.
 */

/** Lo que devuelve la feature apagada. Nunca dice que existe algo apagado. */
const APAGADO = { ok: false as const, error: "No encontramos esa página." };

/** Un único mensaje para los tres motivos de fallo del login. */
const GENERIC_LOGIN_ERROR = "WhatsApp/email o contraseña incorrectos.";

/** Un solo mensaje para todos los motivos por los que un código no sirve. */
const CODIGO_INVALIDO = "Ese código no sirve o ya venció. Pedí uno nuevo.";

export type CuentaResult = { ok: true } | { ok: false; error: string };

const RegisterSchema = z.object({
  phone: z.string().trim().min(6, "Falta tu WhatsApp").max(30),
  name: z.string().trim().min(3, "Poné tu nombre completo").max(160),
  email: z
    .union([z.literal(""), z.email("Revisá el email").max(200)])
    .optional(),
  password: z.string().min(1, "Elegí una contraseña").max(200),
  marketingOptIn: z.boolean().optional(),
});

export async function registrarCliente(input: unknown): Promise<CuentaResult> {
  if (!(await cuentasClientesHabilitadas())) return APAGADO;

  const ip = clientIp(await headers());
  if (
    !rateLimit(`cuenta:registro:${ip}`, {
      limit: CUSTOMER_REGISTER_LIMIT,
      windowMs: CUSTOMER_REGISTER_WINDOW_MS,
    }).ok
  ) {
    return {
      ok: false,
      error: "Demasiados intentos seguidos. Probá más tarde.",
    };
  }

  const parsed = RegisterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Revisá los datos.",
    };
  }

  const strength = validatePasswordStrength(parsed.data.password);
  if (!strength.ok) {
    return {
      ok: false,
      error: passwordStrengthMessage(strength.reason),
    };
  }

  try {
    const customer = await registerCustomer({
      phone: parsed.data.phone,
      password: parsed.data.password,
      name: parsed.data.name,
      email: parsed.data.email || null,
      marketingOptIn: parsed.data.marketingOptIn,
    });

    await abrirSesion(
      customer.id,
      customer.phone,
      customer.name,
      customer.sessionVersion
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof CustomerError)
      return { ok: false, error: error.message };
    console.error("registrarCliente falló", safeError(error).message);
    return { ok: false, error: "No pudimos crear la cuenta. Probá de nuevo." };
  }
}

const LoginSchema = z.object({
  identifier: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});

export async function entrarCliente(input: unknown): Promise<CuentaResult> {
  if (!(await cuentasClientesHabilitadas())) return APAGADO;

  const parsed = LoginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_LOGIN_ERROR };

  // Por IP **y** por identificador, como el login del panel: el atacante rota
  // una de las dos cosas por separado.
  const ip = clientIp(await headers());
  const identifier = parsed.data.identifier.toLowerCase();
  const options = {
    limit: CUSTOMER_LOGIN_LIMIT,
    windowMs: CUSTOMER_LOGIN_WINDOW_MS,
  };
  const byIp = rateLimit(`cuenta:login:ip:${ip}`, options);
  const byId = rateLimit(`cuenta:login:id:${identifier}`, options);

  if (!byIp.ok || !byId.ok) {
    const minutes = Math.ceil(
      Math.max(byIp.retryAfterSeconds, byId.retryAfterSeconds) / 60
    );
    return {
      ok: false,
      error: `Demasiados intentos. Probá de nuevo en ${minutes} minuto${minutes === 1 ? "" : "s"}.`,
    };
  }

  try {
    const customer = await authenticateCustomer(
      parsed.data.identifier,
      parsed.data.password
    );
    if (!customer) return { ok: false, error: GENERIC_LOGIN_ERROR };

    // Quien probó dos contraseñas y acertó no tiene por qué quedar a un
    // intento del bloqueo.
    resetRateLimitKey(`cuenta:login:ip:${ip}`);
    resetRateLimitKey(`cuenta:login:id:${identifier}`);

    await abrirSesion(
      customer.id,
      customer.phone,
      customer.name,
      customer.sessionVersion
    );
    return { ok: true };
  } catch (error) {
    console.error("entrarCliente falló", safeError(error).message);
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }
}

export async function salirCliente(): Promise<CuentaResult> {
  if (!(await cuentasClientesHabilitadas())) return APAGADO;

  await destroyCustomerSession();
  return { ok: true };
}

const PerfilSchema = z.object({
  name: z.string().trim().min(3, "Poné tu nombre completo").max(160),
  email: z
    .union([z.literal(""), z.email("Revisá el email").max(200)])
    .optional(),
  marketingOptIn: z.boolean(),
});

export async function guardarPerfil(input: unknown): Promise<CuentaResult> {
  if (!(await cuentasClientesHabilitadas())) return APAGADO;

  try {
    // El guard antes de mirar la entrada, igual que en `/admin`.
    const actor = await requireCustomerSession();

    const parsed = PerfilSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Revisá los datos.",
      };
    }

    await updateCustomerProfile(actor.customerId, {
      name: parsed.data.name,
      email: parsed.data.email || null,
      marketingOptIn: parsed.data.marketingOptIn,
    });

    // El nombre se muestra desde la sesión: si no se refresca acá, el header
    // sigue saludando con el anterior hasta el próximo login.
    const session = await getCustomerSession();
    session.name = parsed.data.name.trim();
    await session.save();

    revalidatePath("/cuenta");
    return { ok: true };
  } catch (error) {
    if (error instanceof CustomerError)
      return { ok: false, error: error.message };
    console.error("guardarPerfil falló", safeError(error).message);
    return {
      ok: false,
      error: "No pudimos guardar los cambios. Probá de nuevo.",
    };
  }
}

const ReclamarSchema = z.object({
  orderNumber: z.string().trim().min(3).max(16),
  accessToken: z.string().min(16).max(128),
});

/**
 * "¿Querés guardar tus datos?" — ata un pedido de invitado recién hecho a la
 * cuenta con la que se acaba de entrar o registrar.
 *
 * El dominio sólo ata pedidos sin dueño **y** cuyo teléfono es el de la
 * cuenta, así que conocer un número de pedido ajeno no alcanza para adoptarlo.
 */
export async function reclamarPedido(input: unknown): Promise<CuentaResult> {
  if (!(await cuentasClientesHabilitadas())) return APAGADO;

  try {
    const actor = await requireCustomerSession();

    const parsed = ReclamarSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: "No entendí de qué pedido se trata." };

    const claimed = await claimGuestOrder(
      actor.customerId,
      parsed.data.orderNumber,
      parsed.data.accessToken
    );
    if (!claimed) {
      return {
        ok: false,
        error: "Ese pedido no se puede agregar a esta cuenta.",
      };
    }

    revalidatePath("/cuenta");
    return { ok: true };
  } catch (error) {
    console.error("reclamarPedido falló", safeError(error).message);
    return {
      ok: false,
      error: "No pudimos agregar el pedido. Probá de nuevo.",
    };
  }
}

/** Abre la sesión de cliente. No exportada: no es un endpoint. */
async function abrirSesion(
  customerId: number,
  phone: string,
  name: string,
  sessionVersion: number
): Promise<void> {
  const session = await getCustomerSession();
  session.customerId = customerId;
  session.phone = phone;
  session.name = name;
  session.sessionVersion = sessionVersion;
  await session.save();
}

// ---------------------------------------------------------------------------
// Login sin contraseña (PLAN.md FASE 2, PR F)
// ---------------------------------------------------------------------------

const PedirCodigoSchema = z.object({
  phone: z.string().trim().min(6, "Falta tu WhatsApp").max(30),
});

/**
 * Pide un código de acceso por WhatsApp.
 *
 * **Nunca dice si la cuenta existe.** La respuesta es la misma para un número
 * con cuenta y para uno sin cuenta: "si hay una cuenta con ese número, te
 * mandamos un código". Si respondiera distinto, este formulario sería un
 * verificador de quién compra en esta tienda, y no cuesta nada consultarlo.
 *
 * Con `messagingConfigured()` en false —la mayoría de las tiendas hoy— la
 * acción ni existe: el login sólo ofrece contraseña.
 */
export async function pedirCodigoAcceso(input: unknown): Promise<CuentaResult> {
  if (!(await cuentasClientesHabilitadas())) return APAGADO;

  const sender = resolveMessageSender();
  if (!sender) {
    // No debería llegar acá: el formulario no ofrece la opción sin sender.
    // Si llega, es un POST directo — y le contesta lo mismo que a todos.
    return {
      ok: false,
      error: "Esa forma de entrar no está disponible en esta tienda.",
    };
  }

  const parsed = PedirCodigoSchema.safeParse(input);
  if (!parsed.success) return { ok: true };

  const phone = normalizePhonePY(parsed.data.phone);
  if (!phone) return { ok: true };

  // Por IP **y** por teléfono: cada intento manda un mensaje de verdad, y el
  // que recibe la avalancha es el dueño del número, no quien la provoca.
  const ip = clientIp(await headers());
  const options = { limit: OTP_REQUEST_LIMIT, windowMs: OTP_REQUEST_WINDOW_MS };
  if (!rateLimit(`cuenta:otp:ip:${ip}`, options).ok) return { ok: true };
  if (!rateLimit(`cuenta:otp:tel:${phone}`, options).ok) return { ok: true };

  try {
    const customer = await findCustomerByPhone(phone);

    if (customer) {
      const { code } = await issueLoginToken(customer.id, sender.channel);

      // **Sin `await`**, y es la parte importante de esta acción.
      //
      // El cuerpo de la respuesta ya era idéntico existiera o no la cuenta.
      // Lo que no era idéntico era **cuánto tardaba**: con cuenta se hacían
      // dos escrituras y una llamada HTTP a Meta (hasta 10 segundos); sin
      // cuenta, un SELECT por índice y listo. Esa diferencia se mide con un
      // cronómetro desde cualquier lado, y convierte este formulario en el
      // detector de clientas que el mensaje genérico quería evitar.
      //
      // Soltando el envío, las dos ramas contestan igual de rápido. El
      // mensaje sale igual: lo único que se pierde es enterarse del fallo en
      // esta request, y eso ya no se le contaba a nadie.
      void sender
        .send({ to: phone, body: loginCodeMessage(code) })
        .catch((error) =>
          console.error("No pude mandar el código de acceso", error)
        );
    }
  } catch (error) {
    // Tampoco se distingue un fallo de emisión: se registra y se contesta igual.
    console.error("pedirCodigoAcceso falló", safeError(error).message);
  }

  return { ok: true };
}

const CanjearSchema = z.object({
  phone: z.string().trim().min(6).max(30),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "El código son 6 dígitos"),
});

/**
 * Canjea el código y abre la sesión.
 *
 * Un solo mensaje de error para todos los motivos —no existe, ya se usó,
 * venció, lo invalidó un pedido posterior, la cuenta está desactivada— por lo
 * mismo de siempre.
 */
export async function entrarConCodigo(input: unknown): Promise<CuentaResult> {
  if (!(await cuentasClientesHabilitadas())) return APAGADO;
  if (!resolveMessageSender()) {
    return {
      ok: false,
      error: "Esa forma de entrar no está disponible en esta tienda.",
    };
  }

  const ip = clientIp(await headers());
  if (
    !rateLimit(`cuenta:otp-verify:${ip}`, {
      limit: OTP_VERIFY_LIMIT,
      windowMs: OTP_VERIFY_WINDOW_MS,
    }).ok
  ) {
    return {
      ok: false,
      error: "Demasiados intentos. Pedí un código nuevo en unos minutos.",
    };
  }

  const parsed = CanjearSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: CODIGO_INVALIDO };

  try {
    const phone = normalizePhonePY(parsed.data.phone);
    if (
      !phone ||
      !rateLimit(`cuenta:otp-verify:tel:${phone}`, {
        limit: OTP_VERIFY_LIMIT,
        windowMs: OTP_VERIFY_WINDOW_MS,
      }).ok
    ) {
      return { ok: false, error: CODIGO_INVALIDO };
    }
    const consumed = await consumeLoginToken(phone, parsed.data.code);
    if (!consumed) return { ok: false, error: CODIGO_INVALIDO };

    const customer = await findCustomerById(consumed.customerId);
    if (!customer) return { ok: false, error: CODIGO_INVALIDO };

    await abrirSesion(
      customer.id,
      customer.phone,
      customer.name,
      customer.sessionVersion
    );
    return { ok: true };
  } catch (error) {
    console.error("entrarConCodigo falló", safeError(error).message);
    return { ok: false, error: CODIGO_INVALIDO };
  }
}

/** Changing a password revokes every older cookie, including this one. */
export async function guardarContrasena(input: unknown): Promise<CuentaResult> {
  if (!(await cuentasClientesHabilitadas())) return APAGADO;
  try {
    const actor = await requireCustomerSession();
    const parsed = z.object({ password: z.string().max(200) }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "Revisá la contraseña." };
    const strength = validatePasswordStrength(parsed.data.password);
    if (!strength.ok)
      return { ok: false, error: passwordStrengthMessage(strength.reason) };
    const session = await getCustomerSession();
    const version = session.sessionVersion;
    if (version === undefined) return { ok: false, error: GENERIC_LOGIN_ERROR };
    const passwordHash = await hashPassword(parsed.data.password);
    const [result] = await getDb()
      .update(customers)
      .set({
        passwordHash,
        sessionVersion: sql`${customers.sessionVersion} + 1`,
      })
      .where(
        and(
          eq(customers.id, actor.customerId),
          eq(customers.sessionVersion, version),
          eq(customers.isActive, true)
        )
      );
    if (result.affectedRows !== 1)
      return { ok: false, error: GENERIC_LOGIN_ERROR };
    session.sessionVersion = version + 1;
    await session.save();
    revalidatePath("/cuenta");
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "No pudimos guardar la contraseña. Entrá de nuevo.",
    };
  }
}
