import type { Metadata } from "next";

import { CheckoutForm } from "@/components/checkout-form";
import { CheckoutTrust } from "@/components/checkout-trust";
import type { PaymentMethod } from "@/db/schema";
import { BeginCheckoutEvent } from "@/components/funnel-event";
import { hasUsableCoupons } from "@/domain/coupons";
import { findCustomerByPhone } from "@/domain/customers";
import { isPagoparConfigured } from "@/domain/pagopar/config";
import { listShippingZones, offeredPaymentMethods } from "@/domain/shipping";
import { getStoreSettings } from "@/domain/store-settings";
import { lineasDeConfianza } from "@/domain/store-settings-schema";
import { t } from "@/i18n";
import { analyticsActivo } from "@/lib/analytics";
import { waLinkPublico } from "@/lib/comercio";
import { currentCustomer } from "@/lib/customer-session";
import { nombreMedioDePago } from "@/lib/paginas";
import { formatPhonePY } from "@/lib/py";
import { nombreTienda } from "@/lib/marca";
import { readyPaymentMethods } from "@/domain/payment-readiness";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("checkout.meta"),
  robots: { index: false },
};

export default async function CheckoutPage() {
  const zones = await listShippingZones().catch(() => []);
  const cities = zones
    .flatMap((zone) => zone.cities)
    .sort((a, b) => a.localeCompare(b, "es"));
  const pagoparEnabled = isPagoparConfigured();
  const readyPayments = await readyPaymentMethods();
  const contactHref = await waLinkPublico(t("checkout.confianza.waMensaje"));
  // Sin cupones cargados el campo de descuento no se dibuja.
  const hayCupones = await hasUsableCoupons().catch(() => false);

  // Con las cuentas apagadas —el default— esto es null y todo lo de abajo se
  // comporta como antes de que la feature existiera.
  const actor = await currentCustomer();
  const customer = actor ? await findCustomerByPhone(actor.phone) : null;

  // "Comprá tranquilo" (`/admin/ajustes` → checkout). Los medios de pago son
  // los que este checkout ofrece de verdad, no una lista fija.
  const { checkout: confianza } = await getStoreSettings();
  const [medios, waHref]: [PaymentMethod[], string | null] =
    confianza.confianzaActiva
      ? await Promise.all([
          offeredPaymentMethods({ cardEnabled: pagoparEnabled }).catch(
            (): PaymentMethod[] => []
          ),
          waLinkPublico(t("checkout.confianza.waMensaje")),
        ])
      : [[], null];

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("checkout.titulo")}
      </h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {customer
          ? t("checkout.bajadaConCuenta")
          : t("checkout.bajadaInvitado")}
      </p>

      <div className="mt-6">
        <CheckoutForm
          cities={cities}
          pagoparEnabled={pagoparEnabled}
          readyPayments={readyPayments}
          contactHref={contactHref}
          hayCupones={hayCupones}
          nombreTienda={await nombreTienda()}
          prefill={
            customer
              ? {
                  name: customer.name,
                  // El formulario acepta cualquier formato y lo normaliza el
                  // servidor; se muestra en el que ella reconoce.
                  phone: formatPhonePY(customer.phone),
                  email: customer.email ?? "",
                }
              : undefined
          }
        />
      </div>

      {confianza.confianzaActiva ? (
        <div className="mt-6">
          <CheckoutTrust
            titulo={confianza.confianzaTitulo ?? t("checkout.confianza.titulo")}
            lineas={lineasDeConfianza(confianza)}
            mediosDePago={medios.map((method) => ({
              method,
              nombre: nombreMedioDePago(method),
            }))}
            waHref={waHref}
          />
        </div>
      ) : null}

      {/* "Empezó el checkout" para GA4/Meta (src/lib/funnel.ts), sólo con
          algún medidor configurado. */}
      {analyticsActivo() ? <BeginCheckoutEvent /> : null}
    </main>
  );
}
