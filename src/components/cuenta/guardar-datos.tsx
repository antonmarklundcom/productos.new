import Link from "next/link";

import { cuentasClientesHabilitadas } from "@/lib/cuentas";
import { currentCustomer } from "@/lib/customer-session";
import { t } from "@/i18n/client";

/**
 * "¿Querés guardar tus datos?" — el upsell de la cuenta, **después** de la
 * compra (PLAN.md FASE 2, PR E.5).
 *
 * Que aparezca acá y no en el checkout es toda la decisión: en el checkout
 * sería una pared antes de pagar, y esta tienda no tiene paredes. Acá el
 * pedido ya está hecho, la compradora ya consiguió lo que vino a buscar, y la
 * oferta es honesta — "para la próxima", no "para poder seguir".
 *
 * No se muestra con el flag apagado ni a quien ya entró con su cuenta.
 */
export async function GuardarDatosCta({
  orderNumber,
}: {
  orderNumber: string;
}) {
  if (!(await cuentasClientesHabilitadas())) return null;
  if (await currentCustomer()) return null;

  return (
    <section className="border-border bg-muted/40 mt-6 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("cuenta.guardarDatos.titulo")}</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {t("cuenta.guardarDatos.texto", { numero: orderNumber })}
      </p>
      <Link
        href="/cuenta/registro"
        className="border-border mt-3 inline-block rounded-lg border px-4 py-2 text-sm font-medium"
      >
        {t("cuenta.guardarDatos.boton")}
      </Link>
    </section>
  );
}
