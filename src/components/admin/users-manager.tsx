"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  cambiarEstadoUsuario,
  cambiarRolUsuario,
  crearUsuario,
  resetearPassword,
} from "@/app/actions/admin-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { USER_ROLES, type UserRole } from "@/db/enums";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { t } from "@/i18n";

/** Cómo se llama cada rol para el dueño, con lo que puede en una línea. */
const ROLE_LABEL: Record<UserRole, string> = {
  owner: t("panel.rol.owner"),
  staff: t("panel.rol.staff"),
  vendedor: t("panel.rol.vendedor"),
};

const ROLE_HELP: Record<UserRole, string> = {
  owner: t("panel.rol.owner.ayuda"),
  staff: t("panel.rol.staff.ayuda"),
  vendedor: t("panel.rol.vendedor.ayuda"),
};

export type AdminUserCard = {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  isActive: boolean;
  lastLogin: string | null;
};

export function UsersManager({
  users,
  actingUserId,
}: {
  users: AdminUserCard[];
  /** Quién está mirando: para no ofrecerle acciones que se cierran la puerta. */
  actingUserId: number;
}) {
  return (
    <div className="grid gap-6">
      <NewUserForm />

      <ul className="grid gap-3">
        {users.map((user) => (
          <UserRow key={user.id} user={user} actingUserId={actingUserId} />
        ))}
      </ul>
    </div>
  );
}

function NewUserForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<UserRole>("staff");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <div>
        <Button type="button" onClick={() => setOpen(true)}>
          {t("panel.usuario.agregar")}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="border-border grid gap-4 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);

        startTransition(async () => {
          const result = await crearUsuario({
            email: String(data.get("email") ?? ""),
            password: String(data.get("password") ?? ""),
            name: String(data.get("name") ?? ""),
            role,
          });

          if (!result.ok) {
            setError(result.error);
            return;
          }
          toast.success(t("panel.usuario.creado"));
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <h2 className="font-medium">{t("panel.usuario.nuevo")}</h2>

      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="nuevo-email">{t("panel.usuario.email")}</Label>
          <Input id="nuevo-email" name="email" type="email" required autoComplete="off" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="nuevo-name">
            {t("panel.usuario.nombre")}{" "}
            <span className="text-muted-foreground font-normal">{t("checkout.opcional")}</span>
          </Label>
          <Input id="nuevo-name" name="name" autoComplete="off" />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="nuevo-password">{t("panel.usuario.passwordTemporal")}</Label>
        <Input
          id="nuevo-password"
          name="password"
          type="text"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="off"
        />
        {/*
          Se muestra en claro y se dice por qué: esta tienda no manda emails
          (NEW-STORE.md), así que un "le mandamos un link para que la elija"
          sería mentira. La contraseña la escribe el dueño y se la pasa por
          donde quiera; el texto le recuerda que la cambie.
        */}
        <p className="text-muted-foreground text-xs">
          {t("panel.usuario.passwordAyuda", { minimo: MIN_PASSWORD_LENGTH })}
        </p>
      </div>

      <RolePicker value={role} onChange={setRole} idPrefix="nuevo" />

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? t("panel.usuario.creando") : t("panel.usuario.crear")}
        </Button>
        <Button type="button" variant="outline" disabled={isPending} onClick={() => setOpen(false)}>
          {t("panel.abm.cancelar")}
        </Button>
      </div>
    </form>
  );
}

function UserRow({ user, actingUserId }: { user: AdminUserCard; actingUserId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const soyYo = user.id === actingUserId;

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, done: string): void => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? t("panel.abm.noPudimos"));
        return;
      }
      toast.success(done);
      setResetting(false);
      setPassword("");
      router.refresh();
    });
  };

  return (
    <li className="border-border rounded-xl border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium break-all">
          {user.name ? `${user.name} · ` : ""}
          {user.email}
          {soyYo ? (
            <span className="text-muted-foreground font-normal">{t("panel.usuario.vos")}</span>
          ) : null}
        </span>
        <span className="text-sm">
          {ROLE_LABEL[user.role]}
          {user.isActive ? null : (
            <span className="text-muted-foreground">{t("panel.usuario.desactivado")}</span>
          )}
        </span>
      </div>

      <p className="text-muted-foreground mt-1 text-xs">
        {/*
          "Nunca entró" es información distinta de "entró hace mucho": es lo que
          le dice al dueño que la cuenta que creó el martes sigue sin usarse.
        */}
        {user.lastLogin
          ? t("panel.usuario.ultimoIngreso", { fecha: user.lastLogin })
          : t("panel.usuario.nuncaEntro")}
      </p>

      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive mt-2 rounded-lg border p-2 text-xs"
        >
          {error}
        </p>
      ) : null}

      {resetting ? (
        <div className="border-border mt-3 grid gap-2 rounded-lg border p-3">
          <Label htmlFor={`pass-${user.id}`} className="text-xs">
            {t("panel.usuario.passwordNueva", { email: user.email })}
          </Label>
          <Input
            id={`pass-${user.id}`}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="off"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={() =>
                run(
                  () => resetearPassword({ userId: user.id, password }),
                  t("panel.usuario.passwordCambiada"),
                )
              }
            >
              {isPending ? t("panel.acciones.guardando") : t("panel.usuario.cambiarPassword")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => {
                setResetting(false);
                setPassword("");
              }}
            >
              {t("panel.acciones.volver")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={user.role}
            disabled={isPending || soyYo}
            aria-label={t("panel.rol.de", { email: user.email })}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm disabled:opacity-60"
            onChange={(event) =>
              run(
                () =>
                  cambiarRolUsuario({ userId: user.id, role: event.target.value as UserRole }),
                t("panel.usuario.rolActualizado"),
              )
            }
          >
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => setResetting(true)}
          >
            {t("panel.usuario.resetear")}
          </Button>

          {/*
            No se ofrece desactivarse a uno mismo: el dominio lo rechaza igual,
            pero un botón que siempre da error es peor que no tenerlo. Lo del
            último dueño **sí** se ofrece y lo explica el error, porque desde
            acá no se sabe cuántos owners activos quedan sin volver a consultar.
          */}
          {soyYo ? null : (
            <Button
              type="button"
              size="sm"
              variant={user.isActive ? "outline" : "default"}
              disabled={isPending}
              onClick={() =>
                run(
                  () => cambiarEstadoUsuario({ userId: user.id, isActive: !user.isActive }),
                  user.isActive ? t("panel.usuario.desactivadoOk") : t("panel.usuario.reactivadoOk"),
                )
              }
            >
              {user.isActive ? t("panel.abm.desactivar") : t("panel.abm.reactivar")}
            </Button>
          )}
        </div>
      )}

      {soyYo ? (
        <p className="text-muted-foreground mt-2 text-xs">
          {t("panel.usuario.tuCuenta")}
        </p>
      ) : null}
    </li>
  );
}

function RolePicker({
  value,
  onChange,
  idPrefix,
}: {
  value: UserRole;
  onChange: (role: UserRole) => void;
  idPrefix: string;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{t("panel.rol.label")}</legend>
      {USER_ROLES.map((role) => (
        <label key={role} className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={`${idPrefix}-role`}
            className="mt-1"
            checked={value === role}
            onChange={() => onChange(role)}
          />
          <span>
            <span className="font-medium">{ROLE_LABEL[role]}</span>
            <span className="text-muted-foreground block text-xs">{ROLE_HELP[role]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
