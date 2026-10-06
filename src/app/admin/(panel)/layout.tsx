import { redirect } from "next/navigation";
import type React from "react";

import { AdminSidebar, type AdminNavItem } from "@/components/admin/sidebar";
import { countPendingReviews } from "@/domain/reviews";
import { can, type Capability } from "@/lib/permissions";
import { UnauthorizedError, type AdminActor } from "@/lib/session";
import { requireAdminSession } from "@/lib/admin-guard";
import { t, type MessageKey } from "@/i18n";
import { TESTIDS } from "@/lib/testids";
import { cargarIntegraciones } from "@/lib/integraciones-store";

// Only the server's authorized items reach the browser. A saved menu preference
// can reorder this list; it cannot grant capabilities or add destinations.
const navigation: {
  id: AdminNavItem["id"];
  capability: Capability;
  label: MessageKey;
}[] = [
  { id: "resumen", capability: "dashboard", label: "panel.nav.resumen" },
  { id: "pedidos", capability: "pedidos.ver", label: "panel.nav.pedidos" },
  { id: "productos", capability: "productos", label: "panel.nav.productos" },
  { id: "resenas", capability: "resenas", label: "panel.nav.resenas" },
  {
    id: "devoluciones",
    capability: "devoluciones",
    label: "panel.nav.devoluciones",
  },
  { id: "clientes", capability: "clientes", label: "panel.nav.clientes" },
  { id: "cupones", capability: "cupones", label: "panel.nav.cupones" },
  { id: "actividad", capability: "actividad", label: "panel.nav.actividad" },
  { id: "categorias", capability: "categorias", label: "panel.nav.categorias" },
  { id: "envios", capability: "envios", label: "panel.nav.envios" },
  { id: "banco", capability: "banco", label: "panel.nav.banco" },
  { id: "ajustes", capability: "ajustes", label: "panel.nav.ajustes" },
  {
    id: "integraciones",
    capability: "integraciones",
    label: "panel.nav.integraciones",
  },
  { id: "usuarios", capability: "usuarios", label: "panel.nav.usuarios" },
];

/**
 * Puerta del panel: proxy, este layout y los guards de cada server action.
 * Ocultar enlaces por rol es comodidad; cada pantalla y acción conserva
 * su propia comprobación de permisos.
 */
export const dynamic = "force-dynamic";

export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await cargarIntegraciones();
  let actor: AdminActor;
  try {
    actor = await requireAdminSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/admin/login");
    throw error;
  }

  const resenasPendientes = can(actor.role, "resenas")
    ? await countPendingReviews().catch(() => 0)
    : 0;
  const items: AdminNavItem[] = navigation
    .filter((item) => can(actor.role, item.capability))
    .map((item) => ({
      id: item.id,
      href: item.id === "resumen" ? "/admin" : `/admin/${item.id}`,
      label: t(item.label),
      ...(item.id === "pedidos" ? { testId: TESTIDS.adminNavOrders } : {}),
      ...(item.id === "resenas" ? { badge: resenasPendientes } : {}),
    }));

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[17rem_minmax(0,1fr)] print:block print:min-h-0">
      <AdminSidebar items={items} userId={actor.userId} />
      <main className="mx-auto w-full max-w-7xl min-w-0 px-4 py-6 md:px-8 print:max-w-none print:p-0">
        {children}
      </main>
    </div>
  );
}
