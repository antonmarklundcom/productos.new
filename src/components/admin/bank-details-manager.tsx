"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  guardarDatosBancarios,
  quitarQrBancario,
  subirQrBancario,
} from "@/app/actions/admin-banco";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";

export type BankDetailsCard = {
  banco: string;
  titular: string;
  ruc: string;
  cuenta: string;
  tipoCuenta: string;
};

/**
 * El formulario de `/admin/banco`, con el mismo patrón que el resto del panel
 * (`useTransition` + `sonner` + `router.refresh()`): nada de estado optimista,
 * porque lo que se muestra después de guardar tiene que ser lo que quedó en la
 * base y no lo que se tipeó.
 *
 * Los cinco campos se mandan juntos y el dominio los exige juntos: no hay
 * forma de guardar media cuenta desde acá. El QR va por su propio camino
 * —es un archivo— y sólo aparece una vez que los datos están cargados.
 */
export function BankDetailsManager({
  datos,
  qrUrl,
  actualizado,
  desdeEntorno,
}: {
  datos: BankDetailsCard | null;
  qrUrl: string | null;
  actualizado: string | null;
  desdeEntorno: { banco: string; titular: string; cuenta: string } | null;
}) {
  return (
    <div className="grid gap-6">
      {datos === null ? (
        <p className="border-border bg-muted/40 rounded-xl border p-3 text-sm">
          {desdeEntorno
            ? t("panel.banco.desdeEntorno", {
                banco: desdeEntorno.banco,
                titular: desdeEntorno.titular,
                cuenta: desdeEntorno.cuenta,
              })
            : t("panel.banco.sinNada")}
        </p>
      ) : null}

      <BankForm datos={datos} actualizado={actualizado} />

      {datos !== null ? <QrPanel qrUrl={qrUrl} /> : null}
    </div>
  );
}

function BankForm({
  datos,
  actualizado,
}: {
  datos: BankDetailsCard | null;
  actualizado: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="border-border grid gap-4 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);

        startTransition(async () => {
          const result = await guardarDatosBancarios({
            banco: String(data.get("banco") ?? ""),
            titular: String(data.get("titular") ?? ""),
            ruc: String(data.get("ruc") ?? ""),
            cuenta: String(data.get("cuenta") ?? ""),
            tipoCuenta: String(data.get("tipoCuenta") ?? ""),
          });

          if (!result.ok) {
            setError(result.error);
            return;
          }
          toast.success(t("panel.banco.guardado"));
          router.refresh();
        });
      }}
    >
      <h2 className="font-medium">{t("panel.banco.formTitulo")}</h2>

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
          <Label htmlFor="banco-nombre">{t("panel.banco.campo.banco")}</Label>
          <Input
            id="banco-nombre"
            name="banco"
            required
            maxLength={120}
            autoComplete="off"
            defaultValue={datos?.banco ?? ""}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="banco-titular">{t("panel.banco.campo.titular")}</Label>
          <Input
            id="banco-titular"
            name="titular"
            required
            maxLength={160}
            autoComplete="off"
            defaultValue={datos?.titular ?? ""}
          />
          <p className="text-muted-foreground text-xs">{t("panel.banco.titularAyuda")}</p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="banco-ruc">{t("panel.banco.campo.ruc")}</Label>
          <Input
            id="banco-ruc"
            name="ruc"
            required
            maxLength={20}
            autoComplete="off"
            inputMode="numeric"
            defaultValue={datos?.ruc ?? ""}
          />
          <p className="text-muted-foreground text-xs">{t("panel.banco.rucAyuda")}</p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="banco-cuenta">{t("panel.banco.campo.cuenta")}</Label>
          <Input
            id="banco-cuenta"
            name="cuenta"
            required
            maxLength={60}
            autoComplete="off"
            defaultValue={datos?.cuenta ?? ""}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="banco-tipo">{t("panel.banco.campo.tipoCuenta")}</Label>
          <Input
            id="banco-tipo"
            name="tipoCuenta"
            required
            maxLength={60}
            autoComplete="off"
            placeholder={t("panel.banco.tipoCuentaPlaceholder")}
            defaultValue={datos?.tipoCuenta ?? ""}
          />
          <p className="text-muted-foreground text-xs">{t("panel.banco.tipoCuentaAyuda")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? t("panel.acciones.guardando") : t("panel.abm.guardarCambios")}
        </Button>
        {actualizado ? (
          <span className="text-muted-foreground text-xs">
            {t("panel.banco.actualizado", { fecha: actualizado })}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/**
 * El QR del SPI. Opcional: sin él la página del pedido muestra los datos con
 * botón de copiar, que es lo que hacía antes de que esto existiera.
 */
function QrPanel({ qrUrl }: { qrUrl: string | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="border-border grid gap-4 rounded-xl border p-4">
      <div>
        <h2 className="font-medium">{t("panel.banco.qrTitulo")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t("panel.banco.qrBajada")}</p>
      </div>

      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm"
        >
          {error}
        </p>
      ) : null}

      {qrUrl ? (
        <div className="flex flex-wrap items-center gap-4">
          <div className="border-border relative size-40 overflow-hidden rounded-lg border bg-white">
            <Image
              src={qrUrl}
              alt={t("pedido.banco.qrAlt")}
              fill
              unoptimized
              sizes="160px"
              className="object-contain p-2"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await quitarQrBancario();
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                toast.success(t("panel.banco.qrQuitado"));
                router.refresh();
              });
            }}
          >
            {t("panel.banco.qrQuitar")}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("panel.banco.qrVacio")}</p>
      )}

      <form
        ref={formRef}
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const data = new FormData(event.currentTarget);

          startTransition(async () => {
            const result = await subirQrBancario(data);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            formRef.current?.reset();
            toast.success(t("panel.banco.qrSubido"));
            router.refresh();
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="banco-qr">{t("panel.banco.qrArchivo")}</Label>
          <Input
            id="banco-qr"
            name="file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
          />
          <p className="text-muted-foreground text-xs">{t("panel.banco.qrArchivoAyuda")}</p>
        </div>
        <div>
          <Button type="submit" disabled={isPending}>
            {isPending ? t("panel.fotos.subiendo") : t("panel.banco.qrSubir")}
          </Button>
        </div>
      </form>
    </div>
  );
}
