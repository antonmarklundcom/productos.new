import { ImageResponse } from "next/og";

import { TIENDA } from "@/config/tienda";
import { getStoreSettings } from "@/domain/store-settings";
import { OG_IMAGE_SIZE } from "@/lib/images";
import { nombreTienda } from "@/lib/marca";

/**
 * Imagen de Open Graph del sitio — el respaldo de toda la tienda.
 *
 * Next la aplica a cualquier ruta que no declare la suya, así que un producto
 * sin foto cargada igual se comparte con algo mirable en vez de con el
 * rectángulo gris de WhatsApp.
 *
 * Se dibuja en vez de commitear un PNG a propósito: es el archivo que cada
 * tienda nueva se olvidaría de reemplazar, y un `og-image.png` con el nombre
 * de otro comercio es peor que no tener ninguno. El nombre y la bajada salen
 * de `/admin/ajustes` (Identidad y Marca), o de `src/config/tienda.ts` si el
 * dueño no los cargó; se regenera cada hora para seguir al panel.
 */
export const revalidate = 3600;
export const alt = TIENDA.titulo;
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const [nombre, { marca }] = await Promise.all([nombreTienda(), getStoreSettings()]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 90px",
          // Sin tokens de `globals.css`: esto no corre en el navegador y no
          // hay CSS custom properties acá. Neutro a propósito — la piel de
          // cada tienda se rediseña, este archivo no tendría por qué.
          background: "#0b0b0c",
          color: "#fafafa",
          fontSize: 64,
        }}
      >
        <div style={{ fontWeight: 700, letterSpacing: "-0.03em" }}>{nombre}</div>
        <div style={{ marginTop: 24, fontSize: 32, color: "#a1a1aa", lineHeight: 1.35 }}>
          {marca.tagline ?? TIENDA.tagline}
        </div>
      </div>
    ),
    size
  );
}
