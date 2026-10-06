import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SetupForm } from "@/components/setup-form";
import { t } from "@/i18n";

export const metadata: Metadata = {
  title: t("setup.meta"),
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/**
 * `/setup` — la inicialización de una tienda recién deployada, **desde el
 * navegador** (DEPLOY.md §4). Antes era un `curl` a `/api/setup/init`, y es
 * exactamente eso: el formulario llama a esa misma ruta con el mismo secreto,
 * así que el candado (tiempo constante, rate limit, https, 409 si ya estaba
 * inicializada) es uno solo y no hay una segunda puerta que mantener.
 *
 * Sin `SETUP_SECRET` configurado la página **no existe** (404), igual que la
 * ruta responde 503: terminado el setup se saca la variable del hPanel y esto
 * desaparece. El secreto no viaja en la URL ni queda en la página: lo tipea
 * quien deploya y sale en un header, como en el curl.
 */
export default function SetupPage() {
  const secreto = process.env.SETUP_SECRET ?? "";
  if (secreto.length < 16) notFound();

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("setup.titulo")}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{t("setup.bajada")}</p>
      <div className="mt-6">
        <SetupForm />
      </div>
      <p className="text-muted-foreground mt-6 text-xs">{t("setup.despues")}</p>
    </main>
  );
}
