"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarContrasena } from "@/app/actions/cuenta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n/client";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export function CustomerPasswordForm({ required }: { required: boolean }) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <form
      className="mt-8 grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        startTransition(async () => {
          const result = await guardarContrasena({
            password: String(data.get("password") ?? ""),
          });
          setMessage(result.ok ? t("cuenta.password.guardada") : result.error);
          if (result.ok) {
            form.reset();
            router.refresh();
          }
        });
      }}
    >
      <h2 className="font-medium">{t("cuenta.password.titulo")}</h2>
      {required ? (
        <p className="text-sm">{t("cuenta.password.verificada")}</p>
      ) : null}
      <Label htmlFor="new-password">{t("cuenta.password.nueva")}</Label>
      <Input
        id="new-password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={200}
        required
      />
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      <Button disabled={pending}>{t("cuenta.datos.guardar")}</Button>
    </form>
  );
}
