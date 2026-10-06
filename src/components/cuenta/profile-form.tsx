"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { guardarPerfil } from "@/app/actions/cuenta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n/client";

export function CustomerProfileForm({
  defaults,
}: {
  defaults: { name: string; email: string; marketingOptIn: boolean };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [marketingOptIn, setMarketingOptIn] = useState(defaults.marketingOptIn);

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);

        startTransition(async () => {
          const result = await guardarPerfil({
            name: String(data.get("name") ?? ""),
            email: String(data.get("email") ?? ""),
            marketingOptIn,
          });

          if (!result.ok) {
            setError(result.error);
            return;
          }
          toast.success(t("cuenta.datos.guardado"));
          router.refresh();
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
        <Label htmlFor="perfil-name">{t("checkout.nombre")}</Label>
        <Input
          id="perfil-name"
          name="name"
          required
          minLength={3}
          defaultValue={defaults.name}
          autoComplete="name"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="perfil-email">
          {t("checkout.email")}{" "}
          <span className="text-muted-foreground font-normal">
            {t("checkout.opcional")}
          </span>
        </Label>
        <Input
          id="perfil-email"
          name="email"
          type="email"
          defaultValue={defaults.email}
          autoComplete="email"
        />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={marketingOptIn}
          onChange={(event) => setMarketingOptIn(event.target.checked)}
        />
        <span>{t("cuenta.datos.novedades")}</span>
      </label>

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? t("cuenta.datos.guardando") : t("cuenta.datos.guardar")}
        </Button>
      </div>
    </form>
  );
}
