"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveVariantSupplierCost } from "@/app/actions/admin-products";
import type { SupplierOffer } from "@/domain/supplier-costs";
import { productMargin } from "@/lib/product-margin";
import { formatGs } from "@/lib/money";
import { t } from "@/i18n";

type Variant = {
  id: number;
  sku: string;
  pricePyg: number;
  supplierOffers: SupplierOffer[];
};
const field = "border-input bg-background min-w-0 w-full rounded-md border p-2";

export function SupplierCostEditor({
  productId,
  variant,
  ready,
}: {
  productId: number;
  variant: Variant;
  ready: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div
      className="border-border mt-4 rounded-xl border p-4"
      data-testid="supplier-manager"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          {variant.sku} · {formatGs(variant.pricePyg)}
        </h3>
        <button
          type="button"
          disabled={!ready}
          className="text-primary rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => setAdding(!adding)}
        >
          {t("panel.costos.agregar")}
        </button>
      </div>
      {!variant.supplierOffers.length ? (
        <p className="text-muted-foreground mt-3 text-sm">
          {t("panel.costos.sinOfertas")}
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {variant.supplierOffers.map((offer) => (
          <OfferCard
            key={`${offer.id}-${offer.updatedAt.toISOString()}`}
            productId={productId}
            variant={variant}
            offer={offer}
            ready={ready}
          />
        ))}
      </div>
      {adding ? (
        <OfferForm
          productId={productId}
          variant={variant}
          ready={ready}
          onSaved={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

function OfferCard({
  productId,
  variant,
  offer,
  ready,
}: {
  productId: number;
  variant: Variant;
  offer: SupplierOffer;
  ready: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const margin = productMargin(variant.pricePyg, offer.unitCostPyg);
  return (
    <article
      className={`min-w-0 rounded-lg border p-3 ${offer.isPreferred ? "border-primary bg-primary/5" : "border-border"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="font-medium break-words">{offer.source}</h4>
        <span className="text-muted-foreground text-xs">
          {offer.isPreferred
            ? t("panel.costos.preferido")
            : offer.isConfirmed
              ? t("panel.costos.confirmado")
              : t("panel.costos.pendiente")}
          {!offer.isActive ? ` · ${t("panel.costos.inactivo")}` : ""}
        </span>
      </div>
      <p className="mt-2 text-lg font-semibold tabular-nums">
        {offer.unitCostPyg === null ? "—" : formatGs(offer.unitCostPyg)}
      </p>
      <p className="text-muted-foreground text-sm">
        {t("panel.costos.comparacion", {
          margen:
            margin?.marginPercent == null
              ? "—"
              : `${margin.marginPercent.toFixed(1)}%`,
          recargo:
            margin?.markupPercent == null
              ? "—"
              : `${margin.markupPercent.toFixed(1)}%`,
        })}
      </p>
      <p className="mt-2 text-sm">
        {t("panel.costos.stockCapturado", {
          stock:
            offer.supplierStock === null ? "—" : String(offer.supplierStock),
          fecha: offer.checkedAt
            ? offer.checkedAt.toISOString().replace("T", " ").slice(0, 16) +
              " UTC"
            : "—",
        })}
      </p>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {offer.productUrl ? (
          <a
            className="underline"
            href={offer.productUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("panel.costos.enlaceProducto")}
          </a>
        ) : null}
        {offer.supplierUrl ? (
          <a
            className="underline"
            href={offer.supplierUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("panel.costos.enlaceProveedor")}
          </a>
        ) : null}
      </div>
      {offer.notes ? (
        <p className="text-muted-foreground mt-2 text-sm break-words">
          {offer.notes}
        </p>
      ) : null}
      <button
        type="button"
        className="mt-3 rounded-md border px-3 py-2 text-sm"
        onClick={() => setEditing(!editing)}
      >
        {t("panel.costos.editar")}
      </button>
      {editing ? (
        <OfferForm
          productId={productId}
          variant={variant}
          offer={offer}
          ready={ready}
          onSaved={() => setEditing(false)}
        />
      ) : null}
    </article>
  );
}

function OfferForm({
  productId,
  variant,
  offer,
  ready,
  onSaved,
}: {
  productId: number;
  variant: Variant;
  offer?: SupplierOffer;
  ready: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="mt-4 grid gap-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setError(null);
        const nullableNumber = (key: string) =>
          String(data.get(key) ?? "").trim() === ""
            ? null
            : Number(data.get(key));
        const checkedAt = String(data.get("checkedAt") ?? "");
        startTransition(async () => {
          const result = await saveVariantSupplierCost({
            productId,
            variantId: variant.id,
            offerId: offer?.id,
            unitCostPyg: nullableNumber("cost"),
            source: String(data.get("source") ?? ""),
            sourceType: String(data.get("sourceType")),
            productUrl: String(data.get("productUrl") ?? ""),
            supplierUrl: String(data.get("supplierUrl") ?? ""),
            supplierStock: nullableNumber("supplierStock"),
            checkedAt: checkedAt
              ? new Date(checkedAt + "Z").toISOString()
              : null,
            notes: String(data.get("notes") ?? ""),
            isConfirmed: data.get("confirmed") === "on",
            isActive: data.get("active") === "on",
            isPreferred: data.get("preferred") === "on",
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          onSaved();
          router.refresh();
        });
      }}
    >
      <fieldset
        disabled={!ready || pending}
        className="grid min-w-0 gap-3 sm:grid-cols-2"
      >
        <label className="grid gap-1 text-sm">
          {t("panel.costos.origen")}
          <input
            name="source"
            required
            maxLength={200}
            defaultValue={offer?.source ?? ""}
            className={field}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t("panel.costos.tipo")}
          <select
            name="sourceType"
            defaultValue={offer?.sourceType ?? "dropi"}
            className={field}
          >
            <option value="dropi">Dropi</option>
            <option value="local">{t("panel.costos.local")}</option>
            <option value="import">{t("panel.costos.importado")}</option>
            <option value="other">{t("panel.costos.otro")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          {t("panel.costos.unitario")}
          <input
            name="cost"
            type="number"
            min={0}
            step={1}
            defaultValue={offer?.unitCostPyg ?? ""}
            className={field}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t("panel.costos.stock")}
          <input
            name="supplierStock"
            type="number"
            min={0}
            max={4294967295}
            step={1}
            defaultValue={offer?.supplierStock ?? ""}
            className={field}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t("panel.costos.enlaceProducto")}
          <input
            name="productUrl"
            type="url"
            maxLength={2048}
            defaultValue={offer?.productUrl ?? ""}
            className={field}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t("panel.costos.enlaceProveedor")}
          <input
            name="supplierUrl"
            type="url"
            maxLength={2048}
            defaultValue={offer?.supplierUrl ?? ""}
            className={field}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t("panel.costos.fecha")}
          <input
            name="checkedAt"
            type="datetime-local"
            defaultValue={offer?.checkedAt?.toISOString().slice(0, 16) ?? ""}
            className={field}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t("panel.costos.notas")}
          <textarea
            name="notes"
            maxLength={1000}
            defaultValue={offer?.notes ?? ""}
            className={field}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            name="confirmed"
            type="checkbox"
            defaultChecked={offer?.isConfirmed ?? false}
          />
          {t("panel.costos.confirmar")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            name="active"
            type="checkbox"
            defaultChecked={offer?.isActive ?? true}
          />
          {t("panel.costos.activo")}
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            name="preferred"
            type="checkbox"
            defaultChecked={offer?.isPreferred ?? false}
          />
          {t("panel.costos.elegir")}
        </label>
      </fieldset>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!ready || pending}
        className="bg-primary text-primary-foreground justify-self-start rounded-lg px-3 py-2 text-sm disabled:opacity-50"
      >
        {pending ? t("panel.acciones.guardando") : t("panel.costos.guardar")}
      </button>
    </form>
  );
}
