"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // El detalle queda en el log del servidor: al comprador no le decimos
    // qué falló, sólo el digest para poder rastrearlo si escribe.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t("error.titulo")}</h1>
      <p className="text-muted-foreground mt-2 max-w-md text-sm">{t("error.texto")}</p>
      {error.digest ? (
        <p className="text-muted-foreground mt-2 font-mono text-xs">
          {t("error.ref", { digest: error.digest })}
        </p>
      ) : null}
      <Button className="mt-6" onClick={reset}>
        {t("error.reintentar")}
      </Button>
    </main>
  );
}
