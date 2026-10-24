"use client";

import {useState} from "react";
import {useRouter, useSearchParams} from "next/navigation";
import type {BrandFacet} from "@/db/queries";
import {PRICE_RANGES, parseBudget} from "@/lib/price-ranges";
import {Button} from "@/components/ui/button";
import {t} from "@/i18n/client";

const FILTER_KEYS = ["marca", "precio", "categoria", "min", "max"];
const SORTS = {
  relevancia: t("filtros.orden.relevancia"),
  "precio-asc": t("filtros.orden.precioAsc"),
  "precio-desc": t("filtros.orden.precioDesc"),
  nuevos: t("filtros.orden.nuevos"),
};
const FILTER_LABELS: Record<string, string> = {
  marca: t("filtros.marca.label"),
  precio: t("filtros.precio.label"),
  categoria: t("filtros.categoria"),
  min: "Mínimo",
  max: "Máximo",
};
export function CatalogFilters({brands, categories = []}: {brands: BrandFacet[]; categories?: {slug:string;name:string;total:number}[]}) {
 const router = useRouter(), params = useSearchParams();
 const [error, setError] = useState("");
 const update = (changes: Record<string,string|null>) => {
  const next = new URLSearchParams(params.toString());
  for (const [key,value] of Object.entries(changes)) {if (value) next.set(key,value); else next.delete(key);}
  next.delete("page");
  router.push(`?${next}`, {scroll:false});
 };
 const active = FILTER_KEYS.filter(key => params.has(key));
 const control = "border-input bg-background rounded-md border px-3 py-2 text-sm";
 return <div className="grid gap-3">
  <div className="flex flex-wrap items-end gap-3">
   {categories.length ? <label className="grid gap-1 text-sm">{t("filtros.categoria")}<select className={control} value={params.get("categoria") ?? ""} onChange={event => update({categoria:event.target.value})}>
    <option value="">{t("filtros.todasCategorias")}</option>{categories.map(c => <option key={c.slug} value={c.slug}>{c.name} ({c.total})</option>)}
   </select></label> : null}
   {brands.length ? <label className="grid gap-1 text-sm">{t("filtros.marca.label")}<select className={control} value={params.get("marca") ?? ""} onChange={event => update({marca:event.target.value})}>
    <option value="">{t("filtros.marca.todas")}</option>{brands.map(b => <option key={b.brand} value={b.brand}>{t("filtros.marca.conCuenta", {marca:b.brand,n:b.total})}</option>)}
   </select></label> : null}
   <label className="grid gap-1 text-sm">{t("filtros.precio.label")}<select className={control} value={params.get("precio") ?? ""} onChange={event => update({precio:event.target.value,min:null,max:null})}>
    <option value="">{t("filtros.precio.cualquiera")}</option>{PRICE_RANGES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
   </select></label>
   <label className="grid gap-1 text-sm">{t("filtros.orden.label")}<select className={control} value={params.get("orden") ?? "relevancia"} onChange={event => update({orden:event.target.value === "relevancia" ? null : event.target.value})}>
    {Object.entries(SORTS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
   </select></label>
  </div>
  <form method="get" key={params.toString()} className="flex flex-wrap items-end gap-2" onSubmit={event => {
   event.preventDefault(); const form = new FormData(event.currentTarget);
   const min = String(form.get("min") ?? ""), max = String(form.get("max") ?? "");
   const budget = parseBudget(min,max);
   if (budget.invalid) {setError("Usá montos enteros entre 0 y 2.147.483.647 guaraníes."); return;}
   setError(""); update({min:budget.min === undefined ? null : String(budget.min),max:budget.max === undefined ? null : String(budget.max),precio:null});
  }}>
   {[...params.entries()].filter(([key]) => !["min","max","precio","page"].includes(key)).map(([key,value]) => <input key={key} type="hidden" name={key} value={value} />)}
   <label className="grid gap-1 text-sm">Mínimo (Gs.)<input name="min" inputMode="numeric" pattern="[0-9]*" maxLength={10} defaultValue={params.get("min") ?? ""} className={`${control} w-40`} /></label>
   <label className="grid gap-1 text-sm">Máximo (Gs.)<input name="max" inputMode="numeric" pattern="[0-9]*" maxLength={10} defaultValue={params.get("max") ?? ""} className={`${control} w-40`} /></label>
   <Button type="submit" variant="outline">Aplicar presupuesto</Button>
  </form>
  {error ? <p role="alert" className="text-sm">{error}</p> : null}
  {active.length ? <div className="flex flex-wrap gap-2">{active.map(key => <Button key={key} variant="outline" size="sm" onClick={() => update({[key]:null})} aria-label={t("filtros.quitar", {filtro:`${FILTER_LABELS[key] ?? key}: ${params.get(key)}`})}>{FILTER_LABELS[key] ?? key}: {params.get(key)} ×</Button>)}
   <Button variant="ghost" size="sm" onClick={() => update(Object.fromEntries(FILTER_KEYS.map(key => [key,null])))}>{t("filtros.limpiarTodo")}</Button>
  </div> : null}
 </div>;
}
