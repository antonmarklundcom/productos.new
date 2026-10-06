import { ShieldCheck } from "lucide-react";

import type { PaymentMethod } from "@/db/schema";
import { t } from "@/i18n/client";

/**
 * "Comprá tranquilo": el recuadro de confianza del checkout
 * (`/admin/ajustes` → checkout).
 *
 * Tres cosas y ninguna inventada: las líneas que escribió el dueño (o las de
 * siempre), los medios de pago que el checkout **de verdad** ofrece —en texto,
 * sin logos de terceros— y el WhatsApp si la tienda tiene uno.
 *
 * Vive fuera de `checkout-form.tsx` a propósito: ese archivo mezcla piel con
 * la lógica de cotizar y confirmar, y esto es sólo piel.
 */
export function CheckoutTrust({
  titulo,
  lineas,
  mediosDePago,
  waHref,
}: {
  titulo: string;
  lineas: string[];
  /** Ya con su nombre para la compradora. */
  mediosDePago: { method: PaymentMethod; nombre: string }[];
  waHref: string | null;
}) {
  return (
    <aside className="border-border bg-muted/30 rounded-xl border p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <ShieldCheck className="size-4" aria-hidden />
        {titulo}
      </p>

      {lineas.length > 0 ? (
        <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
          {lineas.map((linea) => (
            <li key={linea}>{linea}</li>
          ))}
        </ul>
      ) : null}

      {mediosDePago.length > 0 ? (
        <div className="mt-3">
          <p className="text-muted-foreground text-xs">
            {t("checkout.confianza.medios")}
          </p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {mediosDePago.map((medio) => (
              <li
                key={medio.method}
                className="border-border bg-background rounded-full border px-2.5 py-0.5 text-xs"
              >
                {medio.nombre}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {waHref ? (
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground mt-3 inline-block text-xs underline"
        >
          {t("checkout.confianza.whatsapp")}
        </a>
      ) : null}
    </aside>
  );
}
