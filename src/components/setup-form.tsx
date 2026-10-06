"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";

type Chequeo = {
  id: string;
  severity: "bloquea" | "advierte" | "ok";
  title: string;
  detail: string;
};

type Respuesta = {
  ok?: boolean;
  error?: string;
  detalle?: string;
  pasos?: Record<string, string>;
  preflight?: { checks: Chequeo[]; blocking: number; warnings: number };
};

/**
 * El formulario de `/setup`. Hace el mismo POST que el curl de DEPLOY.md §4:
 * el secreto en `Authorization: Bearer`, el dueño y el catálogo de ejemplo en
 * el cuerpo. Lo que muestra es lo que contesta la ruta — los pasos y el
 * reporte de preflight —, nunca lo que se tipeó.
 */
export function SetupForm() {
  const [isPending, startTransition] = useTransition();
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const passwordMismatch = respuesta?.error === "password_no_coincide";

  return (
    <div className="grid gap-6">
      {respuesta ? <Resultado respuesta={respuesta} /> : null}
      <form
        className="border-border grid gap-4 rounded-xl border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const secreto = String(data.get("secreto") ?? "");
          const email = String(data.get("email") ?? "").trim();
          const password = String(data.get("password") ?? "");
          const passwordConfirm = String(data.get("passwordConfirm") ?? "");
          const nombre = String(data.get("nombre") ?? "").trim();
          if (email !== "" && password !== passwordConfirm) {
            setRespuesta({ ok: false, error: "password_no_coincide" });
            form
              .querySelector<HTMLInputElement>("#setup-password-confirm")
              ?.focus();
            return;
          }
          const cuerpo = {
            seed: data.get("seed") !== null,
            force: data.get("force") !== null,
            ...(email !== ""
              ? {
                  owner: {
                    email,
                    password,
                    ...(nombre ? { name: nombre } : {}),
                  },
                }
              : {}),
          };

          startTransition(async () => {
            setRespuesta(null);
            try {
              const res = await fetch("/api/setup/init", {
                method: "POST",
                headers: {
                  authorization: `Bearer ${secreto}`,
                  "content-type": "application/json",
                },
                body: JSON.stringify(cuerpo),
              });
              const json = (await res.json().catch(() => ({}))) as Respuesta;
              setRespuesta(
                res.ok ? { ...json, ok: true } : { ...json, ok: false }
              );
              // La contraseña y el secreto no se quedan en pantalla.
              if (res.ok) {
                form.reset();
                setOwnerEmail("");
                setShowPassword(false);
              }
            } catch {
              setRespuesta({ ok: false, error: "red" });
            }
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="setup-secreto">{t("setup.secreto")}</Label>
          <Input
            id="setup-secreto"
            name="secreto"
            type="password"
            required
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">
            {t("setup.secretoAyuda")}
          </p>
        </div>

        <fieldset className="border-border grid gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">
            {t("setup.duenio")}
          </legend>
          <div className="grid gap-1.5">
            <Label htmlFor="setup-email">{t("setup.email")}</Label>
            <Input
              id="setup-email"
              name="email"
              type="email"
              autoComplete="off"
              value={ownerEmail}
              onChange={(event) => setOwnerEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="setup-password">{t("setup.password")}</Label>
            <Input
              id="setup-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required={ownerEmail.trim() !== ""}
              aria-invalid={passwordMismatch}
              aria-describedby={passwordMismatch ? "setup-result" : undefined}
              onChange={() => {
                if (passwordMismatch) setRespuesta(null);
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="setup-password-confirm">
              {t("setup.password.confirmar")}
            </Label>
            <Input
              id="setup-password-confirm"
              name="passwordConfirm"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required={ownerEmail.trim() !== ""}
              aria-invalid={passwordMismatch}
              aria-describedby={passwordMismatch ? "setup-result" : undefined}
              onChange={() => {
                if (passwordMismatch) setRespuesta(null);
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(event) => setShowPassword(event.target.checked)}
              aria-controls="setup-password setup-password-confirm"
            />
            {t("setup.password.mostrar")}
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="setup-nombre">{t("setup.nombre")}</Label>
            <Input id="setup-nombre" name="nombre" autoComplete="off" />
          </div>
          <p className="text-muted-foreground text-xs">
            {t("setup.duenioAyuda")}
          </p>
        </fieldset>

        <div className="grid gap-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="seed"
              aria-describedby="setup-seed-help"
            />
            {t("setup.seed")}
          </label>
          <p id="setup-seed-help" className="text-muted-foreground text-xs">
            {t("setup.seedAyuda")}
          </p>
        </div>
        <div className="grid gap-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="force"
              aria-describedby="setup-force-help"
            />
            {t("setup.force")}
          </label>
          <p id="setup-force-help" className="text-muted-foreground text-xs">
            {t("setup.forceAyuda")}
          </p>
        </div>

        <Button type="submit" disabled={isPending}>
          {isPending ? t("setup.corriendo") : t("setup.correr")}
        </Button>
      </form>
    </div>
  );
}

function mensajeDeError(respuesta: Respuesta): string {
  switch (respuesta.error) {
    case "password_no_coincide":
      return t("setup.error.passwordNoCoincide");
    case "unauthorized":
      return t("setup.error.secreto");
    case "rate_limited":
      return t("setup.error.limite");
    case "https_required":
      return t("setup.error.https");
    case "ya_inicializada":
      return t("setup.error.yaInicializada");
    case "password_debil":
    case "cuerpo_invalido":
      return respuesta.detalle ?? t("setup.error.generico");
    case "not_configured":
      return t("setup.error.sinSecreto");
    default:
      return t("setup.error.generico");
  }
}

function Resultado({ respuesta }: { respuesta: Respuesta }) {
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (respuesta.ok) resultRef.current?.focus();
  }, [respuesta.ok]);

  return (
    <div
      id="setup-result"
      ref={resultRef}
      tabIndex={-1}
      role="status"
      className="border-border grid gap-3 rounded-xl border p-4 text-sm"
    >
      <p
        className={
          respuesta.ok ? "font-medium" : "text-destructive font-medium"
        }
      >
        {respuesta.ok ? t("setup.listo") : mensajeDeError(respuesta)}
      </p>
      {respuesta.ok ? (
        <div className="grid justify-items-start gap-3">
          <p>{t("setup.loginAyuda")}</p>
          <Button asChild>
            <Link href="/admin/login">{t("setup.irAlAdmin")}</Link>
          </Button>
        </div>
      ) : null}
      {respuesta.pasos ? (
        <ul className="text-muted-foreground grid gap-1">
          {Object.entries(respuesta.pasos).map(([paso, estado]) => (
            <li key={paso}>
              <span className="text-foreground">{paso}</span>: {estado}
            </li>
          ))}
        </ul>
      ) : null}
      {respuesta.preflight ? (
        <div className="grid gap-1">
          <p className="font-medium">{t("setup.preflight")}</p>
          <ul className="grid gap-1">
            {respuesta.preflight.checks
              .filter((chequeo) => chequeo.severity !== "ok")
              .map((chequeo) => (
                <li key={chequeo.id}>
                  <span
                    className={
                      chequeo.severity === "bloquea" ? "text-destructive" : ""
                    }
                  >
                    {chequeo.severity === "bloquea" ? "✗" : "!"} {chequeo.title}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {chequeo.detail}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
