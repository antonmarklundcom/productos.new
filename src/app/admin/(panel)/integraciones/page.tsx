import type { Metadata } from "next";

import { IntegracionesManager, type TarjetaIntegracion } from "@/components/admin/integraciones-manager";
import { t } from "@/i18n";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { estadoParaPanel } from "@/lib/integraciones-store";
import { formatDateTimePY } from "@/lib/py";

export const metadata: Metadata = { title: t("panel.integraciones.meta") };

export const dynamic = "force-dynamic";

/**
 * `/admin/integraciones` — owner-only.
 *
 * Lo que antes eran variables del hPanel (y un Redeploy por cada dígito mal
 * tipeado): Cloudinary, WhatsApp, Pagopar, la medición y el reporte de
 * errores. Mismo criterio que `/admin/banco`: la pantalla muestra **de dónde
 * sale** cada valor hoy —el panel o el entorno— para que nadie mire un
 * formulario vacío mientras la tienda usa valores que salen de otro lado.
 *
 * Lo que llega al componente cliente **no tiene un solo secreto**: para los
 * secretos viaja `••••1234` o nada (`estadoParaPanel`).
 */
export default async function AdminIntegracionesPage() {
  await requireCapabilityPage("integraciones");

  const { estados, claveDisponible } = await estadoParaPanel();

  const tarjetas: TarjetaIntegracion[] = estados.map((estado) => ({
    integracion: estado.integracion,
    resumen: estado.resumen,
    actualizado: estado.actualizado ? formatDateTimePY(estado.actualizado) : null,
    enPanel: estado.enPanel,
    campos: estado.campos,
  }));

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{t("panel.integraciones.titulo")}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{t("panel.integraciones.bajada")}</p>

      {!claveDisponible ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive mt-4 rounded-lg border p-3 text-sm"
        >
          {t("panel.integraciones.sinClave")}
        </p>
      ) : null}

      <div className="mt-6">
        <IntegracionesManager tarjetas={tarjetas} habilitado={claveDisponible} />
      </div>
    </div>
  );
}
