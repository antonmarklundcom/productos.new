import { MessageCircle } from "lucide-react";

import { t } from "@/i18n/client";
import { waLinkPublico } from "@/lib/comercio";

/**
 * Botón flotante de WhatsApp. En PY es el canal de venta real: si el
 * comprador duda, escribe antes de abandonar el carrito.
 *
 * Al número **público** (`/admin/ajustes` → contacto, o `WHATSAPP_NUMBER`).
 *
 * `data-whatsapp-fab` es el gancho con el que `globals.css` lo sube cuando la
 * barra de compra móvil de la ficha está a la vista (`sticky-buy-bar.tsx`):
 * sin eso, la barra lo taparía.
 */
export async function WhatsAppFab({ message }: { message?: string }) {
  const href = await waLinkPublico(message ?? t("whatsapp.consultaGenerica"));
  if (!href) return null;

  return (
    // El link queda `fixed` igual dentro de un `<nav>` sin posicionar: fixed
    // se ubica contra el viewport salvo que un ancestro cree su propio
    // "containing block" (transform/filter/perspective), y `<nav>` acá no
    // tiene nada de eso. El wrapper es lo que hace falta para que WCAG lo vea
    // contenido por un landmark en vez de flotando suelto en el body.
    <nav aria-label={t("whatsapp.flotante.nav")}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("whatsapp.flotante.label")}
        data-whatsapp-fab=""
        className="fixed right-4 bottom-4 z-40 flex size-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <MessageCircle className="size-7" />
      </a>
    </nav>
  );
}
