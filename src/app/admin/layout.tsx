import type { Metadata } from "next";
import type React from "react";

import { nombreTienda } from "@/lib/marca";

/**
 * Layout raíz de `/admin`. A propósito no tiene guard: el login vive abajo de
 * esta misma rama (`/admin/login`) y un guard acá lo dejaría redirigiendo a sí
 * mismo para siempre. La puerta del panel está en `(panel)/layout.tsx`.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: { default: "Panel", template: `%s · Panel · ${await nombreTienda()}` },
    robots: { index: false, follow: false, nocache: true },
  };
}

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
