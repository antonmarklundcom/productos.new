import type { Metadata } from "next";
import type React from "react";

import { TIENDA } from "@/config/tienda";
import { AnnouncementBar } from "@/components/announcement-bar";
import { Analytics } from "@/components/analytics";
import { CartSheet } from "@/components/cart-sheet";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StorefrontOnly } from "@/components/storefront-only";
import { WhatsAppFab } from "@/components/whatsapp-fab";
import { Toaster } from "@/components/ui/sonner";
import { getStoreSettings } from "@/domain/store-settings";
import { linkSeguro } from "@/domain/store-settings-schema";
import { idiomaActivo } from "@/i18n";
import { siteOrigin } from "@/lib/site-url";
import "./globals.css";
import { cargarIntegraciones } from "@/lib/integraciones-store";
import { marcaEfectiva } from "@/lib/marca";
import { isLocalCatalogPreview } from "@/config/preview";

/**
 * `generateMetadata` y no un `metadata` fijo: el título y la descripción de la
 * home se editan en `/admin/ajustes` ("Marca y portada"). Vacíos, mandan
 * `TIENDA.titulo` y `TIENDA.descripcion`, como siempre.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [{ marca }, identidad] = await Promise.all([
    getStoreSettings(),
    marcaEfectiva(),
  ]);

  return {
    // Sin esto, la URL de la imagen de Open Graph sale relativa y ningún
    // scraper la resuelve: el link compartido queda sin foto (ver lib/site-url).
    metadataBase: siteOrigin() ?? undefined,
    title: {
      default: marca.seoTitulo ?? TIENDA.titulo,
      template: `%s · ${identidad.nombre}`,
    },
    description: marca.seoDescripcion ?? TIENDA.descripcion,
    ...(isLocalCatalogPreview()
      ? { robots: { index: false, follow: false } }
      : {}),
    openGraph: {
      type: "website",
      locale: TIENDA.ogLocale,
      siteName: identidad.nombre,
    },
    // El favicon subido en /admin/ajustes → Identidad. Sin él, queda
    // `src/app/favicon.ico` (el de la tienda o el del template).
    ...(identidad.faviconUrl
      ? { icons: { icon: identidad.faviconUrl, apple: identidad.faviconUrl } }
      : {}),
    // La imagen sale de `opengraph-image.tsx` (o de la del producto, que la
    // pisa); acá sólo se pide que se muestre grande y no como miniatura.
    twitter: { card: "summary_large_image" },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // La foto de integraciones (GA4/Pixel, WhatsApp, Cloudinary) fresca para
  // este render: src/lib/integraciones.ts. Nunca tira.
  const [{ anuncio }, marca] = await Promise.all([
    getStoreSettings(),
    marcaEfectiva(),
    cargarIntegraciones(),
  ]);

  // El idioma **efectivo** y no el que dice el config: si `TIENDA.lang` apunta
  // a un catálogo que no existe, los textos salen en es-PY y el `lang` del
  // HTML tiene que decir es-PY. Un lector de pantalla leyendo español con
  // fonética inglesa es peor que no declarar nada.
  return (
    <html
      lang={idiomaActivo()}
      className="h-full antialiased"
      // El color de marca de /admin/ajustes → Identidad pisa `--primary` del
      // tema (ya validado como #RRGGBB, con el texto encima por contraste).
      style={
        (marca.variablesColor ?? undefined) as React.CSSProperties | undefined
      }
    >
      <body className="flex min-h-full flex-col">
        <a href="#contenido" className="skip-link">
          Saltá al contenido
        </a>
        {isLocalCatalogPreview() ? (
          <div className="preview-notice" role="status">
            Vista previa local · Un producto, imágenes y precio de demostración.
            No está a la venta.
          </div>
        ) : null}
        {/* Apagada o sin texto no se monta nada (y en /admin se esconde sola). */}
        <StorefrontOnly>
          {anuncio.activo && anuncio.texto ? (
            <AnnouncementBar
              texto={anuncio.texto}
              href={linkSeguro(anuncio.href)}
            />
          ) : null}
          <SiteHeader />
        </StorefrontOnly>
        <div id="contenido" className="flex-1" tabIndex={-1}>
          {children}
        </div>
        <StorefrontOnly>
          <SiteFooter />
          <CartSheet />
          <WhatsAppFab />
        </StorefrontOnly>
        <Toaster />
        {/* Nada de terceros salvo que esta tienda configure medidores —
            src/lib/analytics.ts. Sin variables, esto no renderiza nada. */}
        <Analytics />
      </body>
    </html>
  );
}
