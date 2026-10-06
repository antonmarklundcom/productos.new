"use client";

import { MessageCircle } from "lucide-react";

import { t } from "@/i18n/client";
import { waLink } from "@/lib/py";
import { TESTIDS } from "@/lib/testids";

/**
 * "Consultar por WhatsApp" de una variante puntual (plan-operacion §6.3).
 *
 * El texto lleva la variante y el SKU elegidos, así que tiene que armarse acá
 * —el navegador ya sabe cuál variante está seleccionada— y no en el servidor,
 * que sólo vio la primera. Lo que sí viene del servidor es `phone`: el número
 * sale de `WHATSAPP_NUMBER`, una variable sin `NEXT_PUBLIC_`
 * (`src/lib/comercio.ts`), así que este componente nunca lee `process.env` —
 * sólo recibe el número ya resuelto como prop, igual que cualquier otro dato
 * de la página. Sin número configurado no hay `phone` y el link no se dibuja.
 */
export function VariantInquiryLink({
  phone,
  productName,
  variantLabel,
  sku,
  productUrl,
}: {
  phone: string | null;
  productName: string;
  variantLabel: string;
  sku: string;
  /** URL absoluta de la ficha, o `null` sin `NEXT_PUBLIC_SITE_URL`. */
  productUrl: string | null;
}) {
  if (!phone) return null;

  const base = t("producto.consultaVariante", {
    producto: productName,
    variante: variantLabel,
    sku,
  });
  const text = productUrl ? `${base} — ${productUrl}` : base;

  let href: string;
  try {
    href = waLink(phone, text);
  } catch {
    // `phone` ya vino normalizado por `comercioWhatsApp()`; esto es sólo el
    // cinturón por si alguna vez deja de serlo.
    return null;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={TESTIDS.variantInquiryLink}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm underline"
    >
      <MessageCircle className="size-4" aria-hidden />
      {t("producto.consultarWhatsApp")}
    </a>
  );
}
