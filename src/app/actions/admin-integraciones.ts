"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { t } from "@/i18n";
import {
  adminActionError,
  requireOwnerSession,
  type AdminActionResult,
} from "@/lib/admin-guard";
import { esIntegracion, type Integracion } from "@/lib/integraciones";
import { probarIntegracion, type ResultadoPrueba } from "@/lib/integraciones-probar";
import {
  IntegracionError,
  borrarIntegracion,
  cargarIntegraciones,
  guardarIntegracion,
} from "@/lib/integraciones-store";
import { log } from "@/lib/log";

/**
 * `/admin/integraciones` (Cloudinary, WhatsApp, Pagopar, medición, errores).
 * **Todas owner-only**: quien cambia estas credenciales puede mandar los
 * comprobantes a otra cuenta de Cloudinary o cambiar la clave que firma los
 * pagos con tarjeta.
 *
 * Ninguna devuelve un secreto: guardar devuelve los **nombres** de los campos
 * que cambiaron, probar devuelve un texto ya saneado. Lo que se revalida es el
 * layout entero, porque la medición (GA4/Pixel) se dibuja en el HTML cacheado
 * de la home y las categorías.
 */

const GuardarSchema = z.object({
  valores: z.record(z.string(), z.string().max(4_096)),
  borrarSecretos: z.array(z.string()).max(20).default([]),
});

function integracionDe(nombre: unknown): Integracion {
  if (typeof nombre !== "string" || !esIntegracion(nombre)) {
    throw new IntegracionError("adminError.integraciones.integracion");
  }
  return nombre;
}

function revalidar(): void {
  revalidatePath("/", "layout");
  revalidatePath("/admin/integraciones");
}

export async function guardarIntegracionAccion(
  nombre: unknown,
  input: unknown,
): Promise<AdminActionResult<{ cambiados: string[] }>> {
  try {
    const actor = await requireOwnerSession();
    const integracion = integracionDe(nombre);

    const parsed = GuardarSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.revisaDatos") };

    const { cambiados } = await guardarIntegracion(
      integracion,
      { valores: parsed.data.valores, borrarSecretos: parsed.data.borrarSecretos },
      { userId: actor.userId },
    );
    if (cambiados.length > 0) revalidar();
    return { ok: true, cambiados };
  } catch (error) {
    if (error instanceof IntegracionError) return { ok: false, error: error.message };
    return adminActionError("guardarIntegracion", error);
  }
}

export async function volverAlEntornoAccion(nombre: unknown): Promise<AdminActionResult> {
  try {
    const actor = await requireOwnerSession();
    await borrarIntegracion(integracionDe(nombre), { userId: actor.userId });
    revalidar();
    return { ok: true };
  } catch (error) {
    if (error instanceof IntegracionError) return { ok: false, error: error.message };
    return adminActionError("volverAlEntorno", error);
  }
}

/**
 * Prueba la config **efectiva** (la que usa la tienda ahora). El resultado
 * vuelve como `ok: true` con `prueba.ok` adentro: una prueba que falla no es
 * un error de la acción, es la respuesta que el dueño vino a buscar.
 */
export async function probarIntegracionAccion(
  nombre: unknown,
): Promise<AdminActionResult<{ prueba: ResultadoPrueba }>> {
  try {
    const actor = await requireOwnerSession();
    const integracion = integracionDe(nombre);
    await cargarIntegraciones({ forzar: true });

    const prueba = await probarIntegracion(integracion);
    // Auditoría en el log del hPanel: quién probó qué y si anduvo. Sin el
    // mensaje (puede traer el número de WhatsApp) y sin valores.
    log.info("prueba de conexión de integración", {
      integracion,
      resultado: prueba.ok ? "ok" : "fallo",
      actorUserId: actor.userId,
    });
    return { ok: true, prueba };
  } catch (error) {
    if (error instanceof IntegracionError) return { ok: false, error: error.message };
    return adminActionError("probarIntegracion", error);
  }
}
