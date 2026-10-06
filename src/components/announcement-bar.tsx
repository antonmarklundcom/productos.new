"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * La barra de anuncio de arriba de todo ("Envío gratis desde ₲ 300.000",
 * "Cerrado el 24"). Se prende y se escribe en `/admin/ajustes`; apagada o sin
 * texto, el layout ni la monta.
 *
 * Es cliente sólo por una razón: el layout raíz también envuelve `/admin`, y
 * lo único que sabe en qué ruta está es `usePathname`. En el panel no se
 * dibuja: ahí el anuncio de la vidriera es ruido.
 *
 * Piel: cada tienda la puede rediseñar libre (colores, íconos, un botón para
 * cerrarla).
 */
export function AnnouncementBar({ texto, href }: { texto: string; href: string | null }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;

  const contenido = <span className="line-clamp-2">{texto}</span>;
  const externo = href?.startsWith("https://") ?? false;

  return (
    <div className="bg-foreground text-background px-4 py-2 text-center text-xs sm:text-sm">
      {href ? (
        externo ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
            {contenido}
          </a>
        ) : (
          <Link href={href} className="underline-offset-2 hover:underline">
            {contenido}
          </Link>
        )
      ) : (
        contenido
      )}
    </div>
  );
}
