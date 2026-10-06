"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { salirCliente } from "@/app/actions/cuenta";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n/client";

export function CustomerLogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await salirCliente();
          router.push("/");
          router.refresh();
        })
      }
    >
      {isPending ? t("cuenta.saliendo") : t("cuenta.salir")}
    </Button>
  );
}
