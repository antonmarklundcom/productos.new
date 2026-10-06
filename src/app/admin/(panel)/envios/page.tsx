import type { Metadata } from "next";

import { ShippingMethodsManager } from "@/components/admin/shipping-methods-manager";
import { ShippingZonesManager } from "@/components/admin/shipping-zones-manager";
import { listAdminShippingZones } from "@/domain/admin-shipping";
import { listAdminShippingMethods } from "@/domain/admin-shipping-methods";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("panel.envios.meta") };

export const dynamic = "force-dynamic";

/**
 * `/admin/envios` — owner-only (PLAN.md FASE 2, PR K).
 *
 * El checkout ya cotizaba contra estas filas; lo que faltaba era quién las
 * edita. Es la pantalla que más rápido se usa de todo el panel: el flete de
 * una tienda paraguaya cambia con el combustible, y hasta hoy cambiarlo era
 * una llamada al desarrollador.
 *
 * Cambiar una zona **no toca los pedidos en vuelo**: el flete quedó copiado en
 * `orders.shipping_pyg` cuando se creó cada pedido.
 *
 * Desde la FASE 3 la pantalla tiene dos mitades, y el orden importa: primero
 * *cuánto sale llegar a cada ciudad* (las zonas), después *de qué formas se
 * entrega y con cuáles se puede pagar* (los métodos), que es lo que se apoya
 * en las zonas de arriba.
 */
export default async function AdminShippingPage() {
  await requireCapabilityPage("envios");
  const [zones, methods] = await Promise.all([
    listAdminShippingZones(),
    listAdminShippingMethods(),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{t("panel.envios.titulo")}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {t("panel.envios.bajada")}
      </p>

      <div className="mt-6">
        <ShippingZonesManager
          zones={zones.map((zone, index) => ({
            id: zone.id,
            slug: zone.slug,
            name: zone.name,
            cities: zone.cities,
            pricePyg: zone.pricePyg,
            freeThresholdPyg: zone.freeThresholdPyg,
            isActive: zone.isActive,
            esPrimera: index === 0,
            esUltima: index === zones.length - 1,
          }))}
        />
      </div>

      <div className="border-border mt-10 border-t pt-8">
        <h2 className="text-lg font-semibold tracking-tight">{t("panel.metodo.titulo")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t("panel.metodo.bajada")}</p>

        <div className="mt-6">
          <ShippingMethodsManager
            zones={zones.map((zone) => ({
              id: zone.id,
              name: zone.name,
              isActive: zone.isActive,
            }))}
            methods={methods.map((method, index) => ({
              id: method.id,
              slug: method.slug,
              name: method.name,
              kind: method.kind,
              pricing: method.pricing,
              fixedPricePyg: method.fixedPricePyg,
              zoneIds: method.zoneIds,
              allowedPaymentMethods: method.allowedPaymentMethods,
              description: method.description,
              isActive: method.isActive,
              esPrimera: index === 0,
              esUltima: index === methods.length - 1,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
