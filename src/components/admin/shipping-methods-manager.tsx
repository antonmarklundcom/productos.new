"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  cambiarEstadoMetodoEnvio,
  crearMetodoEnvio,
  editarMetodoEnvio,
  moverMetodoEnvio,
} from "@/app/actions/admin-shipping";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatGs } from "@/lib/money";
import { slugify } from "@/lib/slug";
import { t } from "@/i18n";

/**
 * ABM de formas de entrega (`/admin/envios`, FASE 3).
 *
 * Es la mitad que faltaba de esta pantalla. Arriba está *cuánto sale llegar a
 * cada ciudad*; acá, *de qué formas se entrega y con cuáles se puede pagar*.
 * La lógica entera vive en `src/domain/admin-shipping-methods.ts` — esto es
 * markup con estado de formulario, del mismo modo que el manager de zonas.
 */

type MedioDePago = "transferencia" | "contra_entrega" | "tarjeta";
type TipoDeEnvio = "courier" | "local" | "retiro";
type ComoSeCobra = "zona" | "fijo";

/** Escritos acá y no traídos del schema: esto corre en el navegador. */
const PAGOS = ["transferencia", "contra_entrega", "tarjeta"] as const;
const TIPOS = ["courier", "local", "retiro"] as const;

const PAGO_LABEL: Record<MedioDePago, string> = {
  transferencia: t("metodo.transferencia"),
  contra_entrega: t("metodo.contra_entrega"),
  tarjeta: t("metodo.tarjeta"),
};

const TIPO_LABEL: Record<TipoDeEnvio, string> = {
  courier: t("panel.metodo.kind.courier"),
  local: t("panel.metodo.kind.local"),
  retiro: t("panel.metodo.kind.retiro"),
};

export type AdminShippingMethodCard = {
  id: number;
  slug: string;
  name: string;
  kind: TipoDeEnvio;
  pricing: ComoSeCobra;
  fixedPricePyg: number | null;
  zoneIds: number[];
  allowedPaymentMethods: MedioDePago[];
  description: string | null;
  isActive: boolean;
  esPrimera: boolean;
  esUltima: boolean;
};

/** Las zonas, para tildar a cuáles aplica cada método. */
export type ZonaParaMetodo = { id: number; name: string; isActive: boolean };

export function ShippingMethodsManager({
  methods,
  zones,
}: {
  methods: AdminShippingMethodCard[];
  zones: ZonaParaMetodo[];
}) {
  const [editing, setEditing] = useState<number | "nuevo" | null>(null);

  const zonasActivas = new Set(zones.filter((zone) => zone.isActive).map((zone) => zone.id));
  const nombrePorZona = new Map(zones.map((zone) => [zone.id, zone.name] as const));

  return (
    <div className="grid gap-6">
      {editing === "nuevo" ? (
        <MethodForm zones={zones} onDone={() => setEditing(null)} />
      ) : (
        <div>
          <Button type="button" onClick={() => setEditing("nuevo")}>
            {t("panel.metodo.crear")}
          </Button>
        </div>
      )}

      {methods.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-xl border border-dashed p-8 text-center text-sm">
          {t("panel.metodo.vacio")}
        </p>
      ) : (
        <ul className="grid gap-3">
          {methods.map((method) =>
            editing === method.id ? (
              <li key={method.id}>
                <MethodForm method={method} zones={zones} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <MethodRow
                key={method.id}
                method={method}
                nombrePorZona={nombrePorZona}
                zonasActivas={zonasActivas}
                onEdit={() => setEditing(method.id)}
              />
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function MethodRow({
  method,
  nombrePorZona,
  zonasActivas,
  onEdit,
}: {
  method: AdminShippingMethodCard;
  nombrePorZona: Map<number, string>;
  zonasActivas: Set<number>;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, done: string): void => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? t("panel.abm.noPudimos"));
        return;
      }
      toast.success(done);
      router.refresh();
    });
  };

  const precio =
    method.kind === "retiro" || method.fixedPricePyg === 0
      ? t("panel.metodo.gratis")
      : method.pricing === "fijo"
        ? formatGs(method.fixedPricePyg ?? 0)
        : t("panel.metodo.precioPorZona");

  // El agujero silencioso que busca `pnpm preflight`, dicho también acá: el
  // método está prendido, se ve prendido, y no le aparece a nadie.
  const sinZonaActiva =
    method.kind !== "retiro" &&
    method.zoneIds.length > 0 &&
    !method.zoneIds.some((id) => zonasActivas.has(id));

  return (
    <li className="border-border rounded-xl border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium">
          {method.name}
          <span className="text-muted-foreground font-normal"> · {TIPO_LABEL[method.kind]}</span>
          {method.isActive ? null : (
            <span className="text-muted-foreground font-normal">
              {t("panel.metodo.desactivado")}
            </span>
          )}
        </span>
        <span className="text-sm tabular-nums">{precio}</span>
      </div>

      {method.description ? (
        <p className="text-muted-foreground mt-1 text-xs">{method.description}</p>
      ) : null}

      <p className="text-muted-foreground mt-1 text-xs">
        {method.kind === "retiro"
          ? TIPO_LABEL.retiro
          : method.zoneIds.length === 0
            ? t("panel.metodo.zonasTodas")
            : t("panel.metodo.zonasLista", {
                lista: method.zoneIds
                  .map((id) => nombrePorZona.get(id) ?? `#${id}`)
                  .join(", "),
              })}
      </p>

      <p className="text-muted-foreground mt-1 text-xs">
        {t("panel.metodo.pagosLista", {
          lista: method.allowedPaymentMethods.map((pago) => PAGO_LABEL[pago]).join(", "),
        })}
      </p>

      {sinZonaActiva ? (
        <p className="border-border mt-2 rounded-lg border p-2 text-xs">
          {t("panel.metodo.sinZonaActiva")}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive mt-2 rounded-lg border p-2 text-xs"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onEdit} disabled={isPending}>
          {t("panel.abm.editar")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={method.isActive ? "outline" : "default"}
          disabled={isPending}
          onClick={() =>
            run(
              () => cambiarEstadoMetodoEnvio({ methodId: method.id, isActive: !method.isActive }),
              method.isActive
                ? t("panel.metodo.desactivadoOk")
                : t("panel.metodo.activadoOk"),
            )
          }
        >
          {method.isActive ? t("panel.abm.desactivar") : t("panel.abm.activar")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={t("panel.abm.subir", { nombre: method.name })}
          disabled={isPending || method.esPrimera}
          onClick={() =>
            run(
              () => moverMetodoEnvio({ methodId: method.id, direction: "up" }),
              t("panel.abm.ordenActualizado"),
            )
          }
        >
          ↑
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={t("panel.abm.bajar", { nombre: method.name })}
          disabled={isPending || method.esUltima}
          onClick={() =>
            run(
              () => moverMetodoEnvio({ methodId: method.id, direction: "down" }),
              t("panel.abm.ordenActualizado"),
            )
          }
        >
          ↓
        </Button>
      </div>
    </li>
  );
}

function MethodForm({
  method,
  zones,
  onDone,
}: {
  method?: AdminShippingMethodCard;
  zones: ZonaParaMetodo[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(method?.name ?? "");
  const [slug, setSlug] = useState(method?.slug ?? "");
  const [slugTocado, setSlugTocado] = useState(Boolean(method));
  const [kind, setKind] = useState<TipoDeEnvio>(method?.kind ?? "courier");
  const [pricing, setPricing] = useState<ComoSeCobra>(method?.pricing ?? "zona");
  const [zoneIds, setZoneIds] = useState<number[]>(method?.zoneIds ?? []);
  const [pagos, setPagos] = useState<MedioDePago[]>(
    method?.allowedPaymentMethods ?? ["transferencia"],
  );

  // Retiro no viaja: el dominio le vacía zonas y precio igual, así que los
  // campos se esconden en vez de mentir que hacen algo.
  const viaja = kind !== "retiro";

  return (
    <form
      className="border-border grid gap-4 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);

        const tarifa = String(data.get("fixedPricePyg") ?? "").trim();
        const payload = {
          name,
          slug,
          kind,
          pricing: viaja ? pricing : ("fijo" as ComoSeCobra),
          // Vacío no es cero mientras el precio salga de la zona: se manda
          // `null` y el dominio decide si falta.
          fixedPricePyg: viaja && pricing === "fijo" ? Number(tarifa || "0") : null,
          zoneIds: viaja ? zoneIds : [],
          allowedPaymentMethods: pagos,
          description: String(data.get("description") ?? ""),
        };

        startTransition(async () => {
          const result = method
            ? await editarMetodoEnvio({ methodId: method.id, data: payload })
            : await crearMetodoEnvio(payload);

          if (!result.ok) {
            setError(result.error);
            return;
          }
          toast.success(method ? t("panel.metodo.actualizado") : t("panel.metodo.creado"));
          onDone();
          router.refresh();
        });
      }}
    >
      <h3 className="font-medium">
        {method
          ? t("panel.metodo.editarTitulo", { nombre: method.name })
          : t("panel.metodo.nueva")}
      </h3>

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
          <Label htmlFor="metodo-name">{t("panel.metodo.nombre")}</Label>
          <Input
            id="metodo-name"
            value={name}
            required
            minLength={2}
            maxLength={160}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              if (!slugTocado) setSlug(slugify(event.target.value));
            }}
          />
          <p className="text-muted-foreground text-xs">{t("panel.metodo.nombreAyuda")}</p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="metodo-kind">{t("panel.metodo.tipo")}</Label>
          <select
            id="metodo-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as TipoDeEnvio)}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            {TIPOS.map((value) => (
              <option key={value} value={value}>
                {TIPO_LABEL[value]}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">{t("panel.metodo.tipoAyuda")}</p>
        </div>
      </div>

      {viaja ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="metodo-pricing">{t("panel.metodo.pricing")}</Label>
            <select
              id="metodo-pricing"
              value={pricing}
              onChange={(event) => setPricing(event.target.value as ComoSeCobra)}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            >
              <option value="zona">{t("panel.metodo.pricing.zona")}</option>
              <option value="fijo">{t("panel.metodo.pricing.fijo")}</option>
            </select>
            <p className="text-muted-foreground text-xs">{t("panel.metodo.pricingAyuda")}</p>
          </div>

          {pricing === "fijo" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="metodo-precio">{t("panel.metodo.precioFijo")}</Label>
              <Input
                id="metodo-precio"
                name="fixedPricePyg"
                type="number"
                required
                min={0}
                step={1}
                defaultValue={method?.fixedPricePyg ?? ""}
                inputMode="numeric"
              />
              <p className="text-muted-foreground text-xs">{t("panel.metodo.precioFijoAyuda")}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {viaja ? (
        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium">{t("panel.metodo.zonas")}</legend>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {zones.map((zone) => (
              <label key={zone.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={zoneIds.includes(zone.id)}
                  onChange={(event) =>
                    setZoneIds((actuales) =>
                      event.target.checked
                        ? [...actuales, zone.id]
                        : actuales.filter((id) => id !== zone.id),
                    )
                  }
                />
                <span>
                  {zone.name}
                  {zone.isActive ? "" : t("panel.metodo.desactivado")}
                </span>
              </label>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">{t("panel.metodo.zonasAyuda")}</p>
        </fieldset>
      ) : null}

      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium">{t("panel.metodo.pagos")}</legend>
        <div className="mt-1 grid gap-1 sm:grid-cols-3">
          {PAGOS.map((pago) => (
            <label key={pago} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pagos.includes(pago)}
                onChange={(event) =>
                  setPagos((actuales) =>
                    event.target.checked
                      ? [...actuales, pago]
                      : actuales.filter((value) => value !== pago),
                  )
                }
              />
              <span>{PAGO_LABEL[pago]}</span>
            </label>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">{t("panel.metodo.pagosAyuda")}</p>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="metodo-descripcion">
            {t("panel.metodo.descripcion")}{" "}
            <span className="text-muted-foreground font-normal">{t("checkout.opcional")}</span>
          </Label>
          <Input
            id="metodo-descripcion"
            name="description"
            maxLength={200}
            defaultValue={method?.description ?? ""}
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">{t("panel.metodo.descripcionAyuda")}</p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="metodo-slug">{t("panel.metodo.identificador")}</Label>
          <Input
            id="metodo-slug"
            value={slug}
            maxLength={120}
            autoComplete="off"
            onChange={(event) => {
              setSlugTocado(true);
              setSlug(event.target.value);
            }}
          />
          <p className="text-muted-foreground text-xs">{t("panel.metodo.identificadorAyuda")}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending
            ? t("panel.acciones.guardando")
            : method
              ? t("panel.abm.guardarCambios")
              : t("panel.metodo.crear")}
        </Button>
        <Button type="button" variant="outline" disabled={isPending} onClick={onDone}>
          {t("panel.abm.cancelar")}
        </Button>
      </div>
    </form>
  );
}
