import Link from "next/link";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center">
      <p className="text-muted-foreground text-sm">{t("error404.codigo")}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("error404.titulo")}</h1>
      <p className="text-muted-foreground mt-2 max-w-md text-sm">{t("error404.texto")}</p>
      <div className="mt-6 flex gap-3">
        <Button asChild>
          <Link href="/">{t("error404.inicio")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/pedido/buscar">{t("error404.buscarPedido")}</Link>
        </Button>
      </div>
    </main>
  );
}
