"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { registrarCliente } from "@/app/actions/cuenta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { t } from "@/i18n/client";

export function CustomerRegisterForm({
  defaultPhone = "",
}: {
  defaultPhone?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);

        startTransition(async () => {
          const result = await registrarCliente({
            phone: String(data.get("phone") ?? ""),
            name: String(data.get("name") ?? ""),
            email: String(data.get("email") ?? ""),
            password: String(data.get("password") ?? ""),
            marketingOptIn,
          });

          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.push("/cuenta");
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
        <Label htmlFor="name">{t("checkout.nombre")}</Label>
        <Input
          id="name"
          name="name"
          required
          minLength={3}
          autoComplete="name"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="phone">{t("checkout.whatsapp")}</Label>
        <Input
          id="phone"
          name="phone"
          required
          defaultValue={defaultPhone}
          inputMode="tel"
          autoComplete="tel"
          placeholder={t("checkout.whatsapp.placeholder")}
        />
        <p className="text-muted-foreground text-xs">
          {t("cuenta.registro.telefonoAyuda")}
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="email">
          {t("checkout.email")}{" "}
          <span className="text-muted-foreground font-normal">
            {t("checkout.opcional")}
          </span>
        </Label>
        <Input id="email" name="email" type="email" autoComplete="email" />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="password">{t("cuenta.entrar.password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
        <p className="text-muted-foreground text-xs">
          {t("cuenta.registro.passwordAyuda", { minimo: MIN_PASSWORD_LENGTH })}
        </p>
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

      <Button type="submit" disabled={isPending}>
        {isPending ? t("cuenta.registro.creando") : t("cuenta.registro.boton")}
      </Button>
    </form>
  );
}
