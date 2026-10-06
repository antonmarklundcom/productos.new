import type { Metadata } from "next";

import { UsersManager } from "@/components/admin/users-manager";
import { listAdminUsers } from "@/domain/admin-users";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { formatDateTimePY } from "@/lib/py";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("panel.usuarios.meta") };

export const dynamic = "force-dynamic";

/**
 * `/admin/usuarios` — owner-only (PLAN.md FASE 2, PR C).
 *
 * La página que hace al template vendible: el dueño da de alta a su empleada
 * un lunes a la mañana sin llamar a nadie. `pnpm create-owner` queda como el
 * bootstrap del primer dueño y nada más.
 */
export default async function AdminUsersPage() {
  const actor = await requireCapabilityPage("usuarios");
  const users = await listAdminUsers();

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{t("panel.usuarios.titulo")}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {t("panel.usuarios.bajada")}
      </p>

      <div className="mt-6">
        <UsersManager
          actingUserId={actor.userId}
          users={users.map((user) => ({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isActive: user.isActive,
            lastLogin: user.lastLoginAt ? formatDateTimePY(user.lastLoginAt) : null,
          }))}
        />
      </div>
    </div>
  );
}
