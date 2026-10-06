"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";

import { logoutAdmin } from "@/app/actions/admin-auth";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export function LogoutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => startTransition(() => logoutAdmin())}
    >
      <LogOut aria-hidden="true" />
      {isPending ? t("panel.saliendo") : t("panel.salir")}
    </Button>
  );
}
