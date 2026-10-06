"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { entrarConCodigo, pedirCodigoAcceso } from "@/app/actions/cuenta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n/client";

/**
 * Entrar sin contraseña (PLAN.md FASE 2, PR F.3).
 *
 * Dos pasos: pedir el código y canjearlo. El primero **siempre** contesta lo
 * mismo —"si hay una cuenta con ese número, te mandamos un código"— exista o
 * no la cuenta: si dijera algo distinto, este formulario sería un verificador
 * de quién compra acá.
 *
 * Este componente sólo se monta si la tienda tiene con qué mandar mensajes.
 * Esa decisión la toma el servidor (ver `messagingConfigured()`): un botón que
 * no puede mandar nada deja a la persona esperando un mensaje que no llega.
 */
export function CodigoAccesoForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [paso, setPaso] = useState<"telefono" | "codigo">("telefono");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (paso === "codigo") {
    return (
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await entrarConCodigo({ phone, code });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.push("/cuenta");
            router.refresh();
          });
        }}
      >
        <p className="text-muted-foreground text-sm">
          {t("cuenta.codigo.aviso")}
        </p>

        {error ? (
          <p
            role="alert"
            className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm"
          >
            {error}
          </p>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="codigo">{t("cuenta.codigo.label")}</Label>
          <Input
            id="codigo"
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={t("cuenta.codigo.placeholder")}
            className="tabular-nums"
            required
          />
        </div>

        <Button type="submit" disabled={isPending || code.length !== 6}>
          {isPending ? t("cuenta.entrar.entrando") : t("cuenta.entrar.boton")}
        </Button>

        <button
          type="button"
          className="text-muted-foreground text-sm underline"
          onClick={() => {
            setPaso("telefono");
            setCode("");
            setError(null);
          }}
        >
          {t("cuenta.codigo.otroNumero")}
        </button>
      </form>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          // La respuesta no distingue si la cuenta existe, así que el paso
          // siguiente es el mismo en los dos casos.
          await pedirCodigoAcceso({ phone });
          setPaso("codigo");
        });
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="otp-phone">{t("checkout.whatsapp")}</Label>
        <Input
          id="otp-phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          inputMode="tel"
          autoComplete="tel"
          placeholder={t("checkout.whatsapp.placeholder")}
          required
        />
      </div>

      <Button type="submit" variant="outline" disabled={isPending}>
        {isPending ? t("cuenta.codigo.mandando") : t("cuenta.codigo.pedir")}
      </Button>
    </form>
  );
}
