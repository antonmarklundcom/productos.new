import { readBankDetails } from "@/domain/admin-bank";
import { getStoreSettings } from "@/domain/store-settings";
import {
  contactoEfectivo,
  type ContactoEfectivo,
} from "@/domain/store-settings-schema";
import { bankQrUrl } from "@/lib/images";
import { normalizePhonePY, waLink } from "@/lib/py";
import { valorIntegracion } from "@/lib/integraciones";

/**
 * Datos del comercio, leídos del servidor: el panel o el entorno
 * (`src/lib/integraciones.ts`).
 *
 * El número de WhatsApp no lleva `NEXT_PUBLIC_`: los links se arman en
 * Server Components y llegan al navegador ya hechos. Que el dato termine
 * siendo visible en un `href` no es excusa para exponer la variable al
 * bundle — la regla es que el cliente no lee `process.env`.
 */
export function comercioWhatsApp(): string | null {
  // Panel (`/admin/integraciones` → WhatsApp) > `WHATSAPP_NUMBER` > nada.
  return normalizePhonePY(valorIntegracion("whatsapp", "numeroComercio") ?? "");
}

export function comercioWaLink(text: string): string | null {
  const phone = comercioWhatsApp();
  if (!phone) return null;
  return waLink(phone, text);
}

/**
 * El WhatsApp **público** de la tienda: el que ve la compradora en el botón
 * flotante, el pie, las políticas y los "consultá por WhatsApp".
 *
 * Gana el que el dueño cargó en `/admin/ajustes`; sin ése, el del comercio
 * (`/admin/integraciones` → WhatsApp, o `WHATSAPP_NUMBER`). Los avisos **al
 * dueño** (pedido nuevo, comprobante) siguen yendo a `comercioWhatsApp()`:
 * cambiar el número que se publica no puede desviar en silencio los avisos
 * internos a otro teléfono. Son dos campos distintos en dos pantallas.
 *
 * Async porque toca la base (una vez por request: `getStoreSettings` está
 * memoizado). Los componentes cliente reciben el número ya resuelto por prop.
 */
export async function whatsappPublico(): Promise<string | null> {
  return (await contactoPublico()).whatsapp;
}

/** `comercioWaLink`, pero al número público (ver `whatsappPublico`). */
export async function waLinkPublico(text: string): Promise<string | null> {
  const phone = await whatsappPublico();
  if (!phone) return null;
  return waLink(phone, text);
}

/** Todo el contacto público, con la misma precedencia: panel → entorno. */
export async function contactoPublico(): Promise<ContactoEfectivo> {
  const ajustes = await getStoreSettings();
  return contactoEfectivo(ajustes.contacto, comercioWhatsApp());
}

export type DatosBancarios = {
  banco: string;
  titular: string;
  ruc: string;
  cuenta: string;
  tipoCuenta: string;
  /** URL pública del QR SPI, ya armada. `null` si esta tienda no cargó ninguno. */
  qrUrl: string | null;
};

/**
 * Datos bancarios para la página SPI/QR (ARCH.md §5).
 *
 * **Dos fuentes, en este orden** (PLAN.md FASE 2, PR T):
 *
 * 1. La tabla `bank_details`, que el dueño edita desde `/admin/banco`.
 * 2. Las variables `BANCO_*` del entorno — el camino de siempre.
 *
 * El orden es el que importa: la tienda que ya está andando con su `.env`
 * cargado **no cambia en nada** el día que actualiza el template (tabla vacía
 * ⇒ manda el entorno), y el día que el dueño corrige su número de cuenta
 * desde el navegador, esa corrección pisa al entorno sin redeploy. El entorno
 * queda como fallback y no como respaldo: nadie lo va a mantener al día
 * después del primer cambio hecho desde el panel.
 *
 * `null` si falta cualquiera de los cinco campos obligatorios en las dos
 * fuentes — la página los muestra con un aviso en vez de inventar un banco o
 * un RUC de ejemplo, mismo criterio que el 503 del webhook de Pagopar sin
 * configurar.
 *
 * Es `async` porque ahora toca la base. Cada página lo resuelve **una vez** y
 * lo pasa a quien lo necesite (ver `recoveryMessage`): antes de esto, el
 * listado de "por cobrar" lo releía una vez por fila.
 */
export async function getDatosBancarios(
  executor?: import("@/domain/executor").Executor
): Promise<DatosBancarios | null> {
  const fila = await readBankDetails(executor);

  if (fila) {
    return {
      banco: fila.banco,
      titular: fila.titular,
      ruc: fila.ruc,
      cuenta: fila.cuenta,
      tipoCuenta: fila.tipoCuenta,
      qrUrl: bankQrUrl(fila.qrCloudinaryId) ?? qrUrlDeEnv(),
    };
  }

  return datosBancariosDeEnv();
}

/**
 * El camino viejo, intacto: los cinco `BANCO_*` o `null`.
 *
 * Sigue siendo síncrono y sin base a propósito — lo usa `getDatosBancarios`
 * como fallback y es lo que hace que una tienda sin la tabla cargada se
 * comporte exactamente como antes de este PR.
 */
export function datosBancariosDeEnv(): DatosBancarios | null {
  const banco = (process.env.BANCO_NOMBRE ?? "").trim();
  const titular = (process.env.BANCO_TITULAR ?? "").trim();
  const ruc = (process.env.BANCO_RUC ?? "").trim();
  const cuenta = (process.env.BANCO_CUENTA ?? "").trim();
  const tipoCuenta = (process.env.BANCO_TIPO_CUENTA ?? "").trim();

  if (!banco || !titular || !ruc || !cuenta || !tipoCuenta) return null;

  return { banco, titular, ruc, cuenta, tipoCuenta, qrUrl: qrUrlDeEnv() };
}

/** `BANCO_QR_URL` — sigue valiendo, y es el fallback del QR de Cloudinary. */
function qrUrlDeEnv(): string | null {
  return (process.env.BANCO_QR_URL ?? "").trim() || null;
}
