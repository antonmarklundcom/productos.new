"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  guardarIntegracionAccion,
  probarIntegracionAccion,
  volverAlEntornoAccion,
} from "@/app/actions/admin-integraciones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import type { EstadoResumen, Integracion } from "@/lib/integraciones";
import type { CampoPanel } from "@/lib/integraciones-store";
import {
  BAJADA_INTEGRACION,
  CON_PRUEBA,
  ETIQUETA_CAMPO,
  TITULO_INTEGRACION,
} from "@/lib/integraciones-textos";
import { TESTIDS } from "@/lib/testids";

export type TarjetaIntegracion = {
  integracion: Integracion;
  resumen: EstadoResumen;
  actualizado: string | null;
  enPanel: boolean;
  /** Sin secretos: para ellos sólo viaja la máscara. */
  campos: CampoPanel[];
};

/**
 * Las tarjetas de `/admin/integraciones`. Mismo patrón que el resto del panel
 * (`useTransition` + `sonner` + `router.refresh()`): después de guardar se
 * muestra lo que quedó en la base, no lo que se tipeó.
 *
 * Un secreto nunca llega acá: el input arranca vacío y vacío significa "dejá
 * el que está". Para borrarlo hay una casilla aparte, así que reenviar el
 * formulario sin tocarlo no puede borrar nada.
 */
export function IntegracionesManager({
  tarjetas,
  habilitado,
}: {
  tarjetas: TarjetaIntegracion[];
  habilitado: boolean;
}) {
  return (
    <div className="grid gap-6">
      {tarjetas.map((tarjeta) => (
        <IntegracionForm key={tarjeta.integracion} tarjeta={tarjeta} habilitado={habilitado} />
      ))}
    </div>
  );
}

function textoEstado(resumen: EstadoResumen): string {
  if (resumen.estado === "activa") {
    return resumen.fuente === "panel"
      ? t("panel.integraciones.estado.panel")
      : t("panel.integraciones.estado.entorno");
  }
  if (resumen.estado === "incompleta") return t("panel.integraciones.estado.incompleta");
  return t("panel.integraciones.estado.apagada");
}

function IntegracionForm({
  tarjeta,
  habilitado,
}: {
  tarjeta: TarjetaIntegracion;
  habilitado: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const { integracion } = tarjeta;
  const idCampo = (campo: string): string => `integracion-${integracion}-${campo}`;

  return (
    <form
      className="border-border grid gap-4 rounded-xl border p-4"
      data-testid={TESTIDS.integracionCard}
      data-integracion={integracion}
      data-estado={tarjeta.resumen.estado}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setPrueba(null);
        const form = event.currentTarget;
        const data = new FormData(form);

        const valores: Record<string, string> = {};
        const borrarSecretos: string[] = [];
        for (const campo of tarjeta.campos) {
          valores[campo.campo] = String(data.get(campo.campo) ?? "");
          if (campo.secreto && data.get(`${campo.campo}__borrar`) === "on") borrarSecretos.push(campo.campo);
        }

        startTransition(async () => {
          const result = await guardarIntegracionAccion(integracion, { valores, borrarSecretos });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          toast.success(
            result.cambiados.length > 0
              ? t("panel.integraciones.guardado")
              : t("panel.integraciones.sinCambios"),
          );
          // Los secretos tipeados no se quedan en el formulario.
          form.reset();
          router.refresh();
        });
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{t(TITULO_INTEGRACION[integracion])}</h2>
        <span className="text-muted-foreground text-xs">{textoEstado(tarjeta.resumen)}</span>
      </div>
      <p className="text-muted-foreground text-sm">{t(BAJADA_INTEGRACION[integracion])}</p>

      {error ? (
        <p role="alert" className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {tarjeta.campos.map((campo) => (
          <div key={campo.campo} className="grid gap-1.5">
            <Label htmlFor={idCampo(campo.campo)}>{t(ETIQUETA_CAMPO[campo.campo] ?? "panel.integraciones.titulo")}</Label>
            {campo.secreto ? (
              <>
                <p className="text-xs">
                  {campo.ilegible
                    ? t("panel.integraciones.secreto.ilegible")
                    : campo.mascara
                      ? t("panel.integraciones.secreto.configurado", { mascara: campo.mascara })
                      : t("panel.integraciones.secreto.noConfigurado")}
                </p>
                <Input
                  id={idCampo(campo.campo)}
                  name={campo.campo}
                  type="password"
                  autoComplete="new-password"
                  maxLength={4096}
                  disabled={!habilitado}
                  placeholder={t("panel.integraciones.secreto.reemplazar")}
                />
                {campo.mascara || campo.ilegible ? (
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" name={`${campo.campo}__borrar`} disabled={!habilitado} />
                    {t("panel.integraciones.secreto.borrar")}
                  </label>
                ) : null}
              </>
            ) : (
              <Input
                id={idCampo(campo.campo)}
                name={campo.campo}
                autoComplete="off"
                maxLength={512}
                disabled={!habilitado}
                defaultValue={campo.valorPanel ?? ""}
              />
            )}
            <p className="text-muted-foreground text-xs">
              {campo.fuente === "panel"
                ? t("panel.integraciones.fuente.panel")
                : campo.fuente === "entorno"
                  ? t("panel.integraciones.fuente.entorno", { variable: campo.env })
                  : t("panel.integraciones.fuente.ninguna", { variable: campo.env })}
            </p>
          </div>
        ))}
      </div>

      {prueba ? (
        <p
          role="status"
          className={
            prueba.ok
              ? "rounded-lg border border-emerald-600/40 p-3 text-sm"
              : "border-destructive/40 text-destructive rounded-lg border p-3 text-sm"
          }
        >
          {prueba.mensaje}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending || !habilitado} data-testid={TESTIDS.integracionGuardar}>
          {isPending ? t("panel.acciones.guardando") : t("panel.integraciones.guardar")}
        </Button>

        {CON_PRUEBA.includes(integracion) ? (
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            data-testid={TESTIDS.integracionProbar}
            onClick={() => {
              setError(null);
              setPrueba(null);
              startTransition(async () => {
                const result = await probarIntegracionAccion(integracion);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setPrueba(result.prueba);
              });
            }}
          >
            {isPending ? t("panel.integraciones.probando") : t("panel.integraciones.probar")}
          </Button>
        ) : null}

        {tarjeta.enPanel ? (
          <Button
            type="button"
            variant="ghost"
            disabled={isPending || !habilitado}
            onClick={() => {
              if (!window.confirm(t("panel.integraciones.volverConfirmar"))) return;
              setError(null);
              startTransition(async () => {
                const result = await volverAlEntornoAccion(integracion);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                toast.success(t("panel.integraciones.vueltoAlEntorno"));
                router.refresh();
              });
            }}
          >
            {t("panel.integraciones.volverAlEntorno")}
          </Button>
        ) : null}

        {tarjeta.actualizado ? (
          <span className="text-muted-foreground text-xs">
            {t("panel.integraciones.actualizado", { fecha: tarjeta.actualizado })}
          </span>
        ) : null}
      </div>
    </form>
  );
}
