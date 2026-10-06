"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

/**
 * `error.tsx` del panel (S17, plan-crecimiento.md §6.1 F).
 *
 * Antes de este PR, un error dentro de `/admin/**` caía en el `error.tsx`
 * genérico de la tienda (`src/app/error.tsx`): mismo texto que ve la
 * compradora en el checkout, con un "reintentar" que no explica que quien
 * mira la pantalla es del mostrador, no alguien comprando. El límite de este
 * boundary es `src/app/admin/(panel)`: la puerta de login (`/admin/login`)
 * no pasa por acá.
 */
export default function AdminErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // El detalle queda en el log del servidor: quien mira la pantalla sólo
    // necesita el digest para poder reportarlo.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.error.titulo")}</h1>
      <p className="text-muted-foreground mt-2 max-w-md text-sm">{t("admin.error.texto")}</p>
      {error.digest ? (
        <p className="text-muted-foreground mt-2 font-mono text-xs">
          {t("error.ref", { digest: error.digest })}
        </p>
      ) : null}
      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>{t("error.reintentar")}</Button>
        <Button asChild variant="outline">
          <Link href="/admin">{t("admin.error.volver")}</Link>
        </Button>
      </div>
    </main>
  );
}
