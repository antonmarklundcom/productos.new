import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CustomerRegisterForm } from "@/components/cuenta/register-form";
import { currentCustomer } from "@/lib/customer-session";
import { t } from "@/i18n";

export const metadata: Metadata = {
  title: t("cuenta.registro.meta"),
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function RegistroPage() {
  if (await currentCustomer()) redirect("/cuenta");

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight">{t("cuenta.registro.titulo")}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{t("cuenta.registro.bajada")}</p>

      <div className="mt-6">
        <CustomerRegisterForm />
      </div>

      <p className="text-muted-foreground mt-6 text-sm">
        {t("cuenta.registro.yaTenes")}{" "}
        <Link href="/cuenta/entrar" className="underline">
          {t("cuenta.registro.entrar")}
        </Link>
        .
      </p>

      <p className="text-muted-foreground border-border mt-6 border-t pt-4 text-xs">
        {t("cuenta.registro.noHaceFalta")}
      </p>
    </main>
  );
}
