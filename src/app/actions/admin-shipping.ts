"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  AdminShippingError,
  createShippingZone,
  moveShippingZone,
  setShippingZoneActive,
  updateShippingZone,
} from "@/domain/admin-shipping";
import {
  AdminShippingMethodError,
  createShippingMethod,
  moveShippingMethod,
  setShippingMethodActive,
  updateShippingMethod,
} from "@/domain/admin-shipping-methods";
import {
  PAYMENT_METHODS,
  SHIPPING_METHOD_KINDS,
  SHIPPING_METHOD_PRICINGS,
} from "@/db/schema";
import {
  adminActionError,
  requireOwnerSession,
  type AdminActionResult,
} from "@/lib/admin-guard";
import { t } from "@/i18n";

/**
 * ABM de zonas de envío (PLAN.md FASE 2, PR K). **Todas owner-only.**
 *
 * El flete es plata que entra en cada pedido, y el error se cobra en silencio:
 * una zona con el precio viejo no rompe nada, no aparece en ningún log y se
 * descubre al cerrar el mes. Es de las tres cosas que el dueño no delega.
 *
 * El navegador manda el **texto** de las ciudades y un número de guaraníes; la
 * normalización, la unicidad de ciudades entre zonas y la regla de la última
 * zona activa viven en `src/domain/admin-shipping.ts`, adentro de la
 * transacción y con las filas bloqueadas.
 *
 * No se revalida el checkout: la cotización se recalcula server-side en cada
 * pedido (`quoteShipping`), así que no hay ninguna página cacheada con un
 * precio de flete adentro.
 */

// El largo por ciudad es el de `orders.ship_city` (varchar 120): contra esa columna
// se comparan después, así que una ciudad más larga nunca podría coincidir.
const CitiesSchema = z.array(z.string().max(120)).max(400);

const ZoneDataSchema = z.object({
  name: z.string().trim().min(1, t("adminForm.nombreZona")).max(160),
  slug: z.string().trim().max(120).optional(),
  cities: CitiesSchema,
  pricePyg: z.number().int(t("adminForm.precioEntero")).min(0),
  /** `null` explícito = esta zona no ofrece envío gratis. */
  freeThresholdPyg: z.number().int(t("adminForm.umbralEntero")).positive().nullable(),
});

export async function crearZonaEnvio(input: unknown): Promise<AdminActionResult<{ id: number }>> {
  try {
    await requireOwnerSession();

    const parsed = ZoneDataSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.revisaDatos") };
    }

    const created = await createShippingZone({
      name: parsed.data.name,
      slug: parsed.data.slug || null,
      cities: parsed.data.cities,
      pricePyg: parsed.data.pricePyg,
      freeThresholdPyg: parsed.data.freeThresholdPyg,
    });

    revalidatePath("/admin/envios");
    return { ok: true, id: created.id };
  } catch (error) {
    if (error instanceof AdminShippingError) return { ok: false, error: error.message };
    return adminActionError("crearZonaEnvio", error);
  }
}

const UpdateSchema = z.object({
  zoneId: z.number().int().positive(),
  data: ZoneDataSchema,
});

export async function editarZonaEnvio(input: unknown): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const parsed = UpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.revisaDatos") };
    }

    await updateShippingZone({
      zoneId: parsed.data.zoneId,
      data: {
        name: parsed.data.data.name,
        slug: parsed.data.data.slug || null,
        cities: parsed.data.data.cities,
        pricePyg: parsed.data.data.pricePyg,
        freeThresholdPyg: parsed.data.data.freeThresholdPyg,
      },
    });

    revalidatePath("/admin/envios");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminShippingError) return { ok: false, error: error.message };
    return adminActionError("editarZonaEnvio", error);
  }
}

const ActiveSchema = z.object({
  zoneId: z.number().int().positive(),
  isActive: z.boolean(),
});

export async function cambiarEstadoZonaEnvio(input: unknown): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const parsed = ActiveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.noEntendi.zona") };

    await setShippingZoneActive({
      zoneId: parsed.data.zoneId,
      isActive: parsed.data.isActive,
    });

    revalidatePath("/admin/envios");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminShippingError) return { ok: false, error: error.message };
    return adminActionError("cambiarEstadoZonaEnvio", error);
  }
}

const MoveSchema = z.object({
  zoneId: z.number().int().positive(),
  direction: z.enum(["up", "down"]),
});

export async function moverZonaEnvio(input: unknown): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const parsed = MoveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.noEntendi.mover") };

    await moveShippingZone({
      zoneId: parsed.data.zoneId,
      direction: parsed.data.direction,
    });

    revalidatePath("/admin/envios");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminShippingError) return { ok: false, error: error.message };
    return adminActionError("moverZonaEnvio", error);
  }
}

/**
 * ABM de **métodos de envío** (FASE 3). Misma pantalla, mismo guard, mismo
 * motivo: courier, moto propia y retiro son formas de entregar, y cada una
 * decide con qué se puede pagar. Equivocarse acá no rompe nada visible —
 * habilita contra entrega donde nadie va a ir a cobrar, o cobra la tarifa
 * equivocada— así que es owner, como las zonas.
 *
 * Los bordes de largo van a la medida de la columna; el resto de las reglas
 * (retiro sin zonas ni precio, precio fijo obligatorio, medios de pago no
 * vacíos, zonas existentes) vive en `src/domain/admin-shipping-methods.ts`,
 * adentro de la transacción.
 */
const MethodDataSchema = z.object({
  name: z.string().trim().min(1, t("adminForm.nombreMetodo")).max(160),
  slug: z.string().trim().max(120).optional(),
  kind: z.enum(SHIPPING_METHOD_KINDS),
  pricing: z.enum(SHIPPING_METHOD_PRICINGS),
  /** `null` = este método no cobra tarifa plana (la cobra la zona). */
  fixedPricePyg: z.number().int(t("adminForm.precioEntero")).min(0).nullable(),
  /** Vacío = todas las zonas activas. El largo es un tope defensivo. */
  zoneIds: z.array(z.number().int().positive()).max(200),
  allowedPaymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1, t("adminForm.pagosMetodo")),
  // El largo de `shipping_methods.description`.
  description: z.string().trim().max(200).optional(),
});

export async function crearMetodoEnvio(input: unknown): Promise<AdminActionResult<{ id: number }>> {
  try {
    await requireOwnerSession();

    const parsed = MethodDataSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.revisaDatos") };
    }

    const created = await createShippingMethod({
      name: parsed.data.name,
      slug: parsed.data.slug || null,
      kind: parsed.data.kind,
      pricing: parsed.data.pricing,
      fixedPricePyg: parsed.data.fixedPricePyg,
      zoneIds: parsed.data.zoneIds,
      allowedPaymentMethods: parsed.data.allowedPaymentMethods,
      description: parsed.data.description || null,
    });

    revalidatePath("/admin/envios");
    return { ok: true, id: created.id };
  } catch (error) {
    if (error instanceof AdminShippingMethodError) return { ok: false, error: error.message };
    return adminActionError("crearMetodoEnvio", error);
  }
}

const UpdateMethodSchema = z.object({
  methodId: z.number().int().positive(),
  data: MethodDataSchema,
});

export async function editarMetodoEnvio(input: unknown): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const parsed = UpdateMethodSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.revisaDatos") };
    }

    await updateShippingMethod({
      methodId: parsed.data.methodId,
      data: {
        name: parsed.data.data.name,
        slug: parsed.data.data.slug || null,
        kind: parsed.data.data.kind,
        pricing: parsed.data.data.pricing,
        fixedPricePyg: parsed.data.data.fixedPricePyg,
        zoneIds: parsed.data.data.zoneIds,
        allowedPaymentMethods: parsed.data.data.allowedPaymentMethods,
        description: parsed.data.data.description || null,
      },
    });

    revalidatePath("/admin/envios");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminShippingMethodError) return { ok: false, error: error.message };
    return adminActionError("editarMetodoEnvio", error);
  }
}

const ActiveMethodSchema = z.object({
  methodId: z.number().int().positive(),
  isActive: z.boolean(),
});

export async function cambiarEstadoMetodoEnvio(input: unknown): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const parsed = ActiveMethodSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.noEntendi.metodo") };

    await setShippingMethodActive({
      methodId: parsed.data.methodId,
      isActive: parsed.data.isActive,
    });

    revalidatePath("/admin/envios");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminShippingMethodError) return { ok: false, error: error.message };
    return adminActionError("cambiarEstadoMetodoEnvio", error);
  }
}

const MoveMethodSchema = z.object({
  methodId: z.number().int().positive(),
  direction: z.enum(["up", "down"]),
});

export async function moverMetodoEnvio(input: unknown): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const parsed = MoveMethodSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.noEntendi.mover") };

    await moveShippingMethod({
      methodId: parsed.data.methodId,
      direction: parsed.data.direction,
    });

    revalidatePath("/admin/envios");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminShippingMethodError) return { ok: false, error: error.message };
    return adminActionError("moverMetodoEnvio", error);
  }
}
