"use client";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

/**
 * `window.print()` en un componente cliente chico — nada de `onclick` inline
 * en el markup (CSP: `src/proxy.ts` no permite `'unsafe-inline'`). El CSS de
 * impresión vive en `globals.css` bajo `@media print` y usa la clase
 * `s9-no-print` para ocultar este botón y el nav del panel en el papel.
 */
export function PrintButton() {
  return (
    <Button type="button" className="s9-no-print" onClick={() => window.print()}>
      {t("panel.remito.imprimir")}
    </Button>
  );
}
