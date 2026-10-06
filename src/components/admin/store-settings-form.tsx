"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type React from "react";
import { toast } from "sonner";

import {
  guardarAjustes,
  quitarImagenMarca,
  quitarImagenPortada,
  restaurarAjustes,
  subirImagenMarca,
  subirImagenPortada,
} from "@/app/actions/admin-ajustes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StoreSettingsSection } from "@/domain/store-settings-schema";
import { t } from "@/i18n";

/**
 * Cómo se lee cada campo del `FormData`:
 *
 * - `texto`: el string tal cual (vacío = "el de siempre", lo decide el dominio).
 * - `booleano`: un checkbox — marcado o no.
 * - `lista`: varios inputs con el mismo `name` (las líneas del checkout).
 * - `triestado`: un `<select>` con `""` / `"si"` / `"no"` → `null` / `true` / `false`.
 */
export type TipoCampo = "texto" | "booleano" | "lista" | "triestado";

/**
 * Una sección de `/admin/ajustes`: su formulario, su botón de guardar y su
 * "Restaurar valores por defecto". Los campos los dibuja la página (server) y
 * llegan como `children`; esto sólo los junta y los manda. Mismo patrón que
 * el resto del panel: `useTransition` + `sonner` + `router.refresh()`, sin
 * estado optimista — lo que se ve después de guardar es lo que quedó en la
 * base.
 */
export function SettingsSectionForm({
  seccion,
  campos,
  anidarEn,
  restaurar,
  restaurarLabel,
  children,
}: {
  seccion: StoreSettingsSection;
  campos: Record<string, TipoCampo>;
  /** Para "páginas": los valores viajan como `{ [slug]: valores }`. */
  anidarEn?: string;
  /**
   * Qué hace "Restaurar". Sin esto, vuelve la sección entera a sus defaults
   * (`restaurarAjustes`); con esto, guarda estos valores (una sola página).
   */
  restaurar?: Record<string, unknown>;
  restaurarLabel?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const correr = (accion: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) => {
    setError(null);
    startTransition(async () => {
      const result = await accion();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(ok);
      router.refresh();
    });
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const valores = leerCampos(data, campos);
        correr(
          () =>
            guardarAjustes({
              seccion,
              valores: anidarEn ? { [anidarEn]: valores } : valores,
            }),
          t("panel.ajustes.guardado"),
        );
      }}
    >
      {error ? (
        <p role="alert" className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      {children}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? t("panel.acciones.guardando") : t("panel.abm.guardarCambios")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => {
            if (!window.confirm(t("panel.ajustes.restaurarConfirmar"))) return;
            correr(
              () =>
                restaurar
                  ? guardarAjustes({ seccion, valores: restaurar })
                  : restaurarAjustes({ seccion }),
              t("panel.ajustes.restaurado"),
            );
          }}
        >
          {restaurarLabel ?? t("panel.ajustes.restaurar")}
        </Button>
      </div>
    </form>
  );
}

function leerCampos(data: FormData, campos: Record<string, TipoCampo>): Record<string, unknown> {
  const valores: Record<string, unknown> = {};
  for (const [nombre, tipo] of Object.entries(campos)) {
    switch (tipo) {
      case "booleano":
        valores[nombre] = data.get(nombre) !== null;
        break;
      case "lista":
        valores[nombre] = data.getAll(nombre).map((valor) => String(valor));
        break;
      case "triestado": {
        const valor = String(data.get(nombre) ?? "");
        valores[nombre] = valor === "si" ? true : valor === "no" ? false : null;
        break;
      }
      default:
        valores[nombre] = String(data.get(nombre) ?? "");
    }
  }
  return valores;
}

/**
 * La foto de portada: subirla a Cloudinary o sacarla. Va aparte del
 * formulario de "Marca y portada" porque es un archivo, igual que el QR del
 * banco.
 */
export function HeroImagePanel({
  imagenUrl,
  habilitado,
}: {
  /** La foto que se ve hoy (del panel o de `tienda.ts`), ya como URL. */
  imagenUrl: string | null;
  /** `false` sin Cloudinary configurado: no se ofrece una subida que va a fallar. */
  habilitado: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="border-border grid gap-3 rounded-lg border p-3">
      <p className="text-sm font-medium">{t("panel.ajustes.marca.heroImagen")}</p>

      {error ? (
        <p role="alert" className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      {imagenUrl ? (
        <div className="flex flex-wrap items-center gap-4">
          <div className="border-border relative h-24 w-40 overflow-hidden rounded-lg border">
            <Image src={imagenUrl} alt="" fill unoptimized sizes="160px" className="object-cover" />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await quitarImagenPortada();
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                toast.success(t("panel.ajustes.marca.imagenQuitada"));
                router.refresh();
              });
            }}
          >
            {t("panel.ajustes.marca.imagenQuitar")}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("panel.ajustes.marca.imagenVacia")}</p>
      )}

      {habilitado ? (
        <form
          ref={formRef}
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const data = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await subirImagenPortada(data);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              formRef.current?.reset();
              toast.success(t("panel.ajustes.marca.imagenSubida"));
              router.refresh();
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="ajustes-hero-archivo">{t("panel.ajustes.marca.imagenArchivo")}</Label>
            <Input
              id="ajustes-hero-archivo"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required
            />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? t("panel.fotos.subiendo") : t("panel.ajustes.marca.imagenSubir")}
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-xs">{t("panel.ajustes.marca.sinCloudinary")}</p>
      )}
    </div>
  );
}

/**
 * El logo o el favicon de la tienda (`/admin/ajustes` → Identidad): subirlo a
 * Cloudinary o sacarlo. Mismo patrón que la foto de portada.
 */
export function MarcaImagenPanel({
  tipo,
  imagenUrl,
  habilitado,
}: {
  tipo: "logo" | "favicon";
  imagenUrl: string | null;
  habilitado: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const titulo = tipo === "logo" ? t("panel.ajustes.identidad.logo") : t("panel.ajustes.identidad.favicon");
  const ayuda = tipo === "logo" ? t("panel.ajustes.identidad.logoAyuda") : t("panel.ajustes.identidad.faviconAyuda");
  const inputId = `ajustes-${tipo}-archivo`;

  return (
    <div className="border-border grid gap-3 rounded-lg border p-3">
      <p className="text-sm font-medium">{titulo}</p>
      <p className="text-muted-foreground text-xs">{ayuda}</p>

      {error ? (
        <p role="alert" className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      {imagenUrl ? (
        <div className="flex flex-wrap items-center gap-4">
          <div
            className={
              tipo === "logo"
                ? "border-border relative h-12 w-40 overflow-hidden rounded-lg border"
                : "border-border relative size-12 overflow-hidden rounded-lg border"
            }
          >
            <Image src={imagenUrl} alt="" fill unoptimized sizes="160px" className="object-contain" />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await quitarImagenMarca({ tipo });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                toast.success(t("panel.ajustes.marca.imagenQuitada"));
                router.refresh();
              });
            }}
          >
            {t("panel.ajustes.marca.imagenQuitar")}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("panel.ajustes.identidad.sinImagen")}</p>
      )}

      {habilitado ? (
        <form
          ref={formRef}
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const data = new FormData(event.currentTarget);
            data.set("tipo", tipo);
            startTransition(async () => {
              const result = await subirImagenMarca(data);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              formRef.current?.reset();
              toast.success(t("panel.ajustes.marca.imagenSubida"));
              router.refresh();
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>{t("panel.ajustes.marca.imagenArchivo")}</Label>
            <Input id={inputId} name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? t("panel.fotos.subiendo") : t("panel.ajustes.marca.imagenSubir")}
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-xs">{t("panel.ajustes.marca.sinCloudinary")}</p>
      )}
    </div>
  );
}
