"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ORDER_STATUSES, PAYMENT_METHODS } from "@/db/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/order-labels";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

type Defaults = { estado: string; metodo: string; desde: string; hasta: string; q: string };

/**
 * Filtros del listado de pedidos.
 *
 * Navega cambiando la URL en vez de guardar estado propio: así el filtro se
 * puede compartir por WhatsApp, sobrevive al refresh y deja el "atrás" del
 * celular funcionando. El filtrado de verdad pasa en MySQL (ver
 * `domain/admin-orders.ts`).
 */
export function OrderFiltersForm({ defaults }: { defaults: Defaults }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const activeCount = Object.values(defaults).filter((value) => value !== "").length;

  const submit = (form: HTMLFormElement): void => {
    const data = new FormData(form);
    const params = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      const text = String(value).trim();
      if (text !== "") params.set(key, text);
    }
    const qs = params.toString();
    router.push(qs === "" ? "/admin/pedidos" : `/admin/pedidos?${qs}`);
  };

  return (
    <form
      className="border-border grid gap-3 rounded-xl border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
    >
      <div className="flex gap-2">
        <Input
          name="q"
          data-testid={TESTIDS.adminOrdersSearchInput}
          defaultValue={defaults.q}
          placeholder={t("panel.filtros.buscarPedido")}
          aria-label={t("panel.filtros.buscarPedido.label")}
          inputMode="search"
        />
        <Button type="submit" data-testid={TESTIDS.adminOrdersSearchSubmit}>
          {t("panel.filtros.buscar")}
        </Button>
      </div>

      <button
        type="button"
        className="text-muted-foreground justify-self-start text-sm underline"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? t("panel.filtros.ocultar") : t("panel.filtros.mas")}
        {!open && activeCount > 0 ? t("panel.filtros.activos", { n: activeCount }) : ""}
      </button>

      {/* Colapsados por defecto: en un celular, cuatro selects arriba del
          listado empujan los pedidos abajo del pliegue. */}
      {open ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="estado">{t("panel.filtros.estado")}</Label>
            <select
              id="estado"
              name="estado"
              defaultValue={defaults.estado}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            >
              <option value="">{t("panel.filtros.todos")}</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ORDER_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="metodo">{t("panel.filtros.metodo")}</Label>
            <select
              id="metodo"
              name="metodo"
              defaultValue={defaults.metodo}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            >
              <option value="">{t("panel.filtros.todos")}</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABEL[method]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="desde">{t("panel.filtros.desde")}</Label>
            <Input id="desde" name="desde" type="date" defaultValue={defaults.desde} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="hasta">{t("panel.filtros.hasta")}</Label>
            <Input id="hasta" name="hasta" type="date" defaultValue={defaults.hasta} />
          </div>

          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" className="flex-1">
              {t("panel.filtros.aplicar")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/admin/pedidos")}
            >
              {t("panel.filtros.limpiar")}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
