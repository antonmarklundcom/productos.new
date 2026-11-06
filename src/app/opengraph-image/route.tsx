import { ImageResponse } from "next/og";

import { TIENDA } from "@/config/tienda";
import { getStoreSettings } from "@/domain/store-settings";
import { OG_IMAGE_SIZE } from "@/lib/images";
import { nombreTienda } from "@/lib/marca";

// El nombre y la bajada salen de Identidad y Marca. El sitio Next
// anuncia esta ruta explícitamente como su imagen de respaldo.
export const revalidate = 3600;

export async function GET() {
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
    OG_IMAGE_SIZE
  );
}
