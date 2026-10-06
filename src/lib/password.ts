import bcrypt from "bcryptjs";

import { t, type MessageKey } from "@/i18n";

/** Coste de bcrypt. 12 ≈ 250 ms en el slot Node de Hostinger — suficiente. */
export const BCRYPT_ROUNDS = 12;

import { MIN_PASSWORD_LENGTH } from "./password-policy";
export { MIN_PASSWORD_LENGTH } from "./password-policy";

/**
 * Devuelve una **clave del catálogo** y no la frase: el motivo se le muestra a
 * quien está eligiendo la contraseña, así que es texto de tienda y va con el
 * resto (PR R). Quien llama decide si lo muestra tal cual o lo envuelve.
 */
export function validatePasswordStrength(
  password: string
): { ok: true } | { ok: false; reason: MessageKey } {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: "adminError.password.corta" };
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return { ok: false, reason: "adminError.password.simple" };
  }
  return { ok: true };
}

/** El motivo ya resuelto, para quien sólo quiere el texto. */
export function passwordStrengthMessage(reason: MessageKey): string {
  return t(reason, { minimo: MIN_PASSWORD_LENGTH });
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Siempre corre un hash, incluso si el usuario no existe: comparar contra un
 * hash señuelo mantiene constante el tiempo de respuesta y evita que el login
 * sirva para enumerar cuentas.
 */
let dummyHash: string | undefined;

function getDummyHash(): string {
  dummyHash ??= bcrypt.hashSync("contraseña-inexistente", BCRYPT_ROUNDS);
  return dummyHash;
}

export async function verifyPassword(
  password: string,
  hash: string | null | undefined
): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(password, getDummyHash());
    return false;
  }
  return bcrypt.compare(password, hash);
}
