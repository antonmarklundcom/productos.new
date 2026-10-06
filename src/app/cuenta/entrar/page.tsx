import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CodigoAccesoForm } from "@/components/cuenta/codigo-form";
import { CustomerLoginForm } from "@/components/cuenta/login-form";
import { messagingConfigured } from "@/domain/messaging";
import { currentCustomer } from "@/lib/customer-session";
import { t } from "@/i18n";

export const metadata: Metadata = {
  title: t("cuenta.entrar.meta"),
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function EntrarPage() {
  if (await currentCustomer()) redirect("/cuenta");

  // Sin credenciales para mandar mensajes, la opción **no se ofrece**: un
  // botón que no puede funcionar deja a la persona esperando un mensaje que no
  // va a llegar (PLAN.md, PR F.2).
  const conCodigo = messagingConfigured();

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight">{t("cuenta.entrar.titulo")}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{t("cuenta.entrar.bajada")}</p>

      <div className="mt-6">
        <CustomerLoginForm />
      </div>

      {conCodigo ? (
        <div className="border-border mt-6 border-t pt-6">
          <h2 className="text-sm font-medium">{t("cuenta.codigo.titulo")}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t("cuenta.codigo.bajada")}</p>
          <CodigoAccesoForm />
        </div>
      ) : null}

      <p className="text-muted-foreground mt-6 text-sm">
        {t("cuenta.entrar.sinCuenta")}{" "}
        <Link href="/cuenta/registro" className="underline">
          {t("cuenta.entrar.crear")}
        </Link>
        .
      </p>

      {/* Lo más importante de esta pantalla: que se pueda ignorar. */}
      <p className="text-muted-foreground border-border mt-6 border-t pt-4 text-xs">
        {t("cuenta.entrar.noHaceFalta")}
      </p>
    </main>
  );
}
