"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { COUPON_TYPES } from "@/db/schema";
import {
  AdminCouponError,
  createCoupon,
  setCouponActive,
  updateCoupon,
} from "@/domain/admin-coupons";
import {
  adminActionError,
  requireOwnerSession,
  type AdminActionResult,
} from "@/lib/admin-guard";
import { parsePyDateInput, parsePyDateInputEnd } from "@/lib/py";
import { t } from "@/i18n";

/**
 * ABM de cupones (PLAN.md FASE 2, PR G.4). **Owner-only.**
 *
 * Un cupón es plata que la tienda resigna en cada venta, y a diferencia de un
 * precio mal puesto —que se ve en la vidriera— un cupón mal puesto se descubre
 * cuando ya lo usaron cien personas. Va en el mismo grupo que los reembolsos y
 * los exports: cosas que el dueño no delega (ARCH.md §1).
 *
 * Las validaciones de plata viven en `src/domain/admin-coupons.ts`; acá sólo se
 * parsea la entrada del formulario.
 */

const CouponSchema = z.object({
  code: z.string().trim().min(3, t("adminForm.codigoCupon")).max(40),
  type: z.enum(COUPON_TYPES),
  // Entero y nada más: es un porcentaje (1..100) o guaraníes enteros. Un float
  // acá es el principio de un descuento que no cuadra.
  value: z.number().int(t("adminForm.valorEntero")).positive(),
  minOrderPyg: z.number().int().nonnegative().nullable().optional(),
  desde: z.string().trim().optional(),
  hasta: z.string().trim().optional(),
  maxUses: z.number().int().positive().nullable().optional(),
  maxUsesPerCustomer: z.number().int().positive().nullable().optional(),
  soloClientes: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

function toInput(data: z.infer<typeof CouponSchema>) {
  return {
    code: data.code,
    type: data.type,
    value: data.value,
    minOrderPyg: data.minOrderPyg ?? null,
    // Las fechas llegan en dd/mm/yyyy y se interpretan en hora de Paraguay:
    // "hasta el 31/8" tiene que incluir todo el 31, no cortar a medianoche.
    startsAt: data.desde ? parsePyDateInput(data.desde) : null,
    endsAt: data.hasta ? parsePyDateInputEnd(data.hasta) : null,
    maxUses: data.maxUses ?? null,
    maxUsesPerCustomer: data.maxUsesPerCustomer ?? null,
    soloClientes: data.soloClientes ?? false,
    isActive: data.isActive ?? true,
  };
}

export async function crearCupon(input: unknown): Promise<AdminActionResult<{ id: number }>> {
  try {
    await requireOwnerSession();

    const parsed = CouponSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.revisaDatos") };
    }

    const id = await createCoupon(toInput(parsed.data));

    revalidatePath("/admin/cupones");
    revalidatePath("/checkout");
    return { ok: true, id };
  } catch (error) {
    if (error instanceof AdminCouponError) return { ok: false, error: error.message };
    return adminActionError("crearCupon", error);
  }
}

const EditSchema = CouponSchema.extend({ id: z.number().int().positive() });

export async function editarCupon(input: unknown): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const parsed = EditSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.revisaDatos") };
    }

    await updateCoupon(parsed.data.id, toInput(parsed.data));

    revalidatePath("/admin/cupones");
    revalidatePath("/checkout");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminCouponError) return { ok: false, error: error.message };
    return adminActionError("editarCupon", error);
  }
}

const ToggleSchema = z.object({
  id: z.number().int().positive(),
  isActive: z.boolean(),
});

export async function cambiarEstadoCupon(input: unknown): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const parsed = ToggleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.noEntendi.cupon") };

    await setCouponActive(parsed.data.id, parsed.data.isActive);

    revalidatePath("/admin/cupones");
    revalidatePath("/checkout");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminCouponError) return { ok: false, error: error.message };
    return adminActionError("cambiarEstadoCupon", error);
  }
}
