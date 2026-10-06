"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { USER_ROLES } from "@/db/schema";
import {
  AdminUserError,
  createAdminUser,
  resetAdminUserPassword,
  setAdminUserActive,
  setAdminUserRole,
} from "@/domain/admin-users";
import {
  adminActionError,
  requireOwnerSession,
  type AdminActionResult,
} from "@/lib/admin-guard";
import { t } from "@/i18n";

/**
 * Gestión de usuarios del panel (PLAN.md FASE 2, PR C).
 *
 * **Todas owner-only.** Repartir accesos es repartir todo lo demás: quien
 * puede crear un usuario puede crearse un segundo dueño. Es una de las tres
 * cosas que el owner no delega (ARCH.md §1).
 *
 * Las reglas duras —no desactivarte a vos mismo, no dejar la tienda sin dueño
 * activo— **no** están acá: viven en `src/domain/admin-users.ts`, adentro de
 * la transacción y con las filas bloqueadas. Acá arriba serían una carrera:
 * dos pestañas degradando a los dos últimos owners a la vez pasarían las dos
 * validaciones mirando la misma foto vieja.
 */

const CreateSchema = z.object({
  email: z.email(t("adminForm.email")).max(200),
  password: z.string().min(1, t("adminForm.passwordTemporal")).max(200),
  name: z.string().trim().max(160).optional(),
  role: z.enum(USER_ROLES),
});

export async function crearUsuario(input: unknown): Promise<AdminActionResult<{ id: number }>> {
  try {
    await requireOwnerSession();

    const parsed = CreateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.revisaDatos") };
    }

    const created = await createAdminUser({
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.name || null,
      role: parsed.data.role,
    });

    revalidatePath("/admin/usuarios");
    return { ok: true, id: created.id };
  } catch (error) {
    if (error instanceof AdminUserError) return { ok: false, error: error.message };
    return adminActionError("crearUsuario", error);
  }
}

const ActiveSchema = z.object({
  userId: z.number().int().positive(),
  isActive: z.boolean(),
});

export async function cambiarEstadoUsuario(input: unknown): Promise<AdminActionResult> {
  try {
    const actor = await requireOwnerSession();

    const parsed = ActiveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.noEntendi.usuario") };

    await setAdminUserActive({
      userId: parsed.data.userId,
      isActive: parsed.data.isActive,
      // De la sesión, no del formulario: si el "quién soy" viajara en el
      // input, la regla de "no te desactives a vos mismo" se saltea mandando
      // el id de otro.
      actingUserId: actor.userId,
    });

    revalidatePath("/admin/usuarios");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminUserError) return { ok: false, error: error.message };
    return adminActionError("cambiarEstadoUsuario", error);
  }
}

const RoleSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(USER_ROLES),
});

export async function cambiarRolUsuario(input: unknown): Promise<AdminActionResult> {
  try {
    const actor = await requireOwnerSession();

    const parsed = RoleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.noEntendi.rol") };

    await setAdminUserRole({
      userId: parsed.data.userId,
      role: parsed.data.role,
      actingUserId: actor.userId,
    });

    revalidatePath("/admin/usuarios");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminUserError) return { ok: false, error: error.message };
    return adminActionError("cambiarRolUsuario", error);
  }
}

const ResetSchema = z.object({
  userId: z.number().int().positive(),
  password: z.string().min(1, t("adminForm.passwordNueva")).max(200),
});

export async function resetearPassword(input: unknown): Promise<AdminActionResult> {
  try {
    await requireOwnerSession();

    const parsed = ResetSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.revisaDatos") };
    }

    await resetAdminUserPassword({
      userId: parsed.data.userId,
      password: parsed.data.password,
    });

    revalidatePath("/admin/usuarios");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminUserError) return { ok: false, error: error.message };
    return adminActionError("resetearPassword", error);
  }
}
