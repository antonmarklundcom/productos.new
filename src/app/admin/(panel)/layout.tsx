import Link from "next/link";
import { redirect } from "next/navigation";
import type React from "react";

import { LogoutButton } from "@/components/admin/logout-button";
import { countPendingReviews } from "@/domain/reviews";
import { can } from "@/lib/permissions";
import { UnauthorizedError, type AdminActor } from "@/lib/session";
import { requireAdminSession } from "@/lib/admin-guard";
import { t } from "@/i18n";
import { TESTIDS } from "@/lib/testids";
import { cargarIntegraciones } from "@/lib/integraciones-store";

/**
 * Puerta del panel. Todo lo que cuelga de este layout exige sesión de admin.
 *
 * Es la segunda de tres capas: middleware (redirige), este layout (no
 * renderiza), y `requireAdminSession()` adentro de cada server action (la que
 * de verdad frena una escritura). Las dos primeras son comodidad; si sólo
 * quedara la tercera, el panel seguiría siendo seguro.
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

  // Un COUNT sobre una tabla chica: el número en el menú es lo que hace que
  // alguien entre a moderar. Si la
  // consulta falla, el menú sale sin número y el panel sigue andando.
  const resenasPendientes = can(actor.role, "resenas")
    ? await countPendingReviews().catch(() => 0)
    : 0;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-border bg-background sticky top-0 z-10 border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
          <Link
            href={can(actor.role, "dashboard") ? "/admin" : "/admin/pedidos"}
            className="font-semibold tracking-tight"
          >
            {t("panel.titulo")}
          </Link>
          {/*
            Nav por rol: un vendedor ve "Pedidos" y nada más. Esconder el link
            no es la defensa —las acciones tienen su guard y las pantallas su
            `requireCapability`—, es no ofrecerle a alguien una puerta que le
            va a contestar 403.
          */}
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto text-sm">
            {can(actor.role, "dashboard") ? (
              <NavLink href="/admin">{t("panel.nav.resumen")}</NavLink>
            ) : null}
            <NavLink href="/admin/pedidos" testId={TESTIDS.adminNavOrders}>
              {t("panel.nav.pedidos")}
            </NavLink>
            {can(actor.role, "productos") ? (
              <NavLink href="/admin/productos">
                {t("panel.nav.productos")}
              </NavLink>
            ) : null}
            {can(actor.role, "resenas") ? (
              <NavLink href="/admin/resenas">
                {resenasPendientes > 0
                  ? t("panel.nav.resenasPendientes", { n: resenasPendientes })
                  : t("panel.nav.resenas")}
              </NavLink>
            ) : null}
            {can(actor.role, "devoluciones") ? (
              <NavLink href="/admin/devoluciones">
                {t("panel.nav.devoluciones")}
              </NavLink>
            ) : null}
            {can(actor.role, "clientes") ? (
              <NavLink href="/admin/clientes">
                {t("panel.nav.clientes")}
              </NavLink>
            ) : null}
            {can(actor.role, "cupones") ? (
              <NavLink href="/admin/cupones">{t("panel.nav.cupones")}</NavLink>
            ) : null}
            {can(actor.role, "actividad") ? (
              <NavLink href="/admin/actividad">
                {t("panel.nav.actividad")}
              </NavLink>
            ) : null}
            {can(actor.role, "categorias") ? (
              <NavLink href="/admin/categorias">
                {t("panel.nav.categorias")}
              </NavLink>
            ) : null}
            {can(actor.role, "envios") ? (
              <NavLink href="/admin/envios">{t("panel.nav.envios")}</NavLink>
            ) : null}
            {can(actor.role, "banco") ? (
              <NavLink href="/admin/banco">{t("panel.nav.banco")}</NavLink>
            ) : null}
            {can(actor.role, "ajustes") ? (
              <NavLink href="/admin/ajustes">{t("panel.nav.ajustes")}</NavLink>
            ) : null}
            {can(actor.role, "integraciones") ? (
              <NavLink href="/admin/integraciones">
                {t("panel.nav.integraciones")}
              </NavLink>
            ) : null}
            {can(actor.role, "usuarios") ? (
              <NavLink href="/admin/usuarios">
                {t("panel.nav.usuarios")}
              </NavLink>
            ) : null}
          </nav>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}

function NavLink({
  href,
  children,
  testId,
}: {
  href: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="hover:bg-muted shrink-0 rounded-lg px-3 py-1.5 whitespace-nowrap"
    >
      {children}
    </Link>
  );
}
