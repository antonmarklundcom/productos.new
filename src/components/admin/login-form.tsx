"use client";

import { useState, useTransition } from "react";

import { loginAdmin } from "@/app/actions/admin-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { TESTIDS } from "@/lib/testids";

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        data.set("next", next);

        startTransition(async () => {
          // Si entra, la acción hace `redirect()` y nunca devuelve; sólo
          // volvemos acá cuando falló.
          const result = await loginAdmin(data);
          setError(result.error);
        });
      }}
    >
      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor="email">{t("panel.login.email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          data-testid={TESTIDS.adminLoginEmail}
          required
          autoComplete="username"
          autoCapitalize="none"
          inputMode="email"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="password">{t("panel.login.password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          data-testid={TESTIDS.adminLoginPassword}
          required
          autoComplete="current-password"
        />
      </div>

      <Button type="submit" data-testid={TESTIDS.adminLoginSubmit} disabled={isPending}>
        {isPending ? t("panel.login.entrando") : t("panel.login.entrar")}
      </Button>
    </form>
  );
}
