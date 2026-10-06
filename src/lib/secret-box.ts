import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { validSessionSecret } from "./session-secret";

/**
 * Cifrado de los secretos que el dueño carga desde `/admin/integraciones`
 * (`api_secret` de Cloudinary, token de WhatsApp Cloud, clave privada de
 * Pagopar).
 *
 * **AES-256-GCM** con una clave derivada de `SESSION_SECRET` por **HKDF-SHA256**.
 * Tres decisiones, y las tres salen de la misma pregunta: ¿qué se pierde si se
 * filtra la base (un backup, un dump, un `SELECT` de alguien con acceso)?
 *
 * 1. **La clave no está en la base.** Sale de `SESSION_SECRET`, que vive en el
 *    hPanel. Un backup de la base —que sí sale de la máquina, a Cloudinary—
 *    trae los secretos cifrados y nada con qué abrirlos.
 * 2. **Una clave por uso.** El `info` de HKDF es el contexto (`integraciones/
 *    pagopar/privateKey`), así que cada campo tiene su propia clave, y además
 *    el contexto va como AAD del GCM: el blob del token de WhatsApp pegado en
 *    la columna de la clave de Pagopar no descifra. La clave derivada tampoco
 *    sirve para firmar cookies de iron-session: es otra clave.
 * 3. **Sin `SESSION_SECRET` válido no se hace nada.** Ni cifrar ni descifrar:
 *    tira `SecretBoxUnavailableError`, y quien llama decide (el panel lo
 *    muestra, la lectura cae al entorno). Nunca un default "por si acaso": una
 *    clave inventada cifra datos que nadie puede volver a abrir, o peor, que
 *    cualquiera con el repo sí.
 *
 * Formato: `v1.<iv>.<tag>.<ciphertext>`, cada parte en base64url. La versión
 * va adelante para poder rotar el esquema sin adivinar qué es cada fila.
 *
 * **Cambiar `SESSION_SECRET` invalida lo guardado** (además de cerrar las
 * sesiones del panel, como siempre). Los secretos quedan en la base pero ya no
 * se pueden leer: el panel lo dice ("no se puede descifrar: cargalo de nuevo")
 * y esa integración queda apagada, nunca a medias.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;
/** Sal fija y pública: HKDF la pide, el secreto de verdad es el IKM. */
const HKDF_SALT = "ecom/secret-box/v1";

export class SecretBoxUnavailableError extends Error {
  constructor() {
    super(
      "SESSION_SECRET no está configurado (o es el placeholder, o mide menos de 32): " +
        "no se pueden leer ni guardar secretos de integraciones"
    );
    this.name = "SecretBoxUnavailableError";
  }
}

export class SecretBoxDecryptError extends Error {
  constructor() {
    // Sin el blob ni el contexto en el mensaje: el mensaje llega al log.
    super("no se pudo descifrar un secreto guardado (¿cambió SESSION_SECRET?)");
    this.name = "SecretBoxDecryptError";
  }
}

/**
 * ¿`SESSION_SECRET` sirve como material de clave? La misma regla que
 * `pnpm preflight` e iron-session: 32 o más, y no el placeholder de
 * `.env.example`.
 */
export function secretBoxDisponible(
  env: Record<string, string | undefined> = process.env
): boolean {
  return materialDeClave(env) !== null;
}

function materialDeClave(
  env: Record<string, string | undefined>
): string | null {
  const secreto = (env.SESSION_SECRET ?? "").trim();
  if (!validSessionSecret(secreto)) return null;
  return secreto;
}

function derivarClave(
  contexto: string,
  env: Record<string, string | undefined>
): Buffer {
  const material = materialDeClave(env);
  if (material === null) throw new SecretBoxUnavailableError();
  if (contexto.trim() === "")
    throw new Error("secret-box: el contexto no puede estar vacío");
  return Buffer.from(
    hkdfSync("sha256", material, HKDF_SALT, `ecom/${contexto}`, KEY_BYTES)
  );
}

/** Cifra `texto` para `contexto`. Tira `SecretBoxUnavailableError` sin clave. */
export function cifrarSecreto(
  texto: string,
  contexto: string,
  env: Record<string, string | undefined> = process.env
): string {
  const clave = derivarClave(contexto, env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", clave, iv);
  cipher.setAAD(Buffer.from(contexto, "utf8"));
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, cifrado]
    .map((parte) =>
      typeof parte === "string" ? parte : parte.toString("base64url")
    )
    .join(".");
}

/**
 * Descifra un blob de `cifrarSecreto`. Tira `SecretBoxUnavailableError` sin
 * clave y `SecretBoxDecryptError` si el blob no abre (otra clave, otro
 * contexto, bytes tocados).
 */
export function descifrarSecreto(
  blob: string,
  contexto: string,
  env: Record<string, string | undefined> = process.env
): string {
  const clave = derivarClave(contexto, env);
  const partes = blob.split(".");
  if (partes.length !== 4 || partes[0] !== VERSION)
    throw new SecretBoxDecryptError();

  try {
    const [, iv, tag, cifrado] = partes.map((parte) =>
      Buffer.from(parte, "base64url")
    );
    if (!iv || !tag || !cifrado || iv.length !== IV_BYTES)
      throw new SecretBoxDecryptError();
    const decipher = createDecipheriv("aes-256-gcm", clave, iv);
    decipher.setAAD(Buffer.from(contexto, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString(
      "utf8"
    );
  } catch {
    throw new SecretBoxDecryptError();
  }
}

/**
 * Lo único de un secreto que puede llegar al navegador: `••••1234`.
 *
 * Con menos de 12 caracteres no se muestra ni un dígito — cuatro de ocho es la
 * mitad del secreto.
 */
export function enmascararSecreto(secreto: string): string {
  const limpio = secreto.trim();
  if (limpio.length < 12) return "••••";
  return `••••${limpio.slice(-4)}`;
}
