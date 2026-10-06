import type { Metadata } from "next";

import { BankDetailsManager } from "@/components/admin/bank-details-manager";
import { readBankDetails } from "@/domain/admin-bank";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { datosBancariosDeEnv } from "@/lib/comercio";
import { bankQrUrl } from "@/lib/images";
import { formatDateTimePY } from "@/lib/py";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("panel.banco.meta") };

export const dynamic = "force-dynamic";

/**
 * `/admin/banco` — owner-only (PLAN.md FASE 2, PR T).
 *
 * A dónde transfieren las compradoras. Vivía sólo en `BANCO_*` del entorno, o
 * sea que corregir un dígito del número de cuenta era un cambio en el hPanel y
 * un redeploy: una llamada al desarrollador para arreglar el dato del que
 * depende el método de pago principal de la tienda.
 *
 * La pantalla muestra **las dos fuentes** cuando la tabla está vacía: lo que
 * hoy sale de las variables de entorno, y el formulario para pisarlo desde
 * acá. Esconder el fallback dejaría al dueño mirando un formulario vacío
 * mientras su tienda muestra datos correctos, sin entender de dónde salen.
 */
export default async function AdminBankPage() {
  await requireCapabilityPage("banco");

  const fila = await readBankDetails();
  const env = datosBancariosDeEnv();

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{t("panel.banco.titulo")}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{t("panel.banco.bajada")}</p>

      <div className="mt-6">
        <BankDetailsManager
          datos={
            fila
              ? {
                  banco: fila.banco,
                  titular: fila.titular,
                  ruc: fila.ruc,
                  cuenta: fila.cuenta,
                  tipoCuenta: fila.tipoCuenta,
                }
              : null
          }
          qrUrl={fila ? bankQrUrl(fila.qrCloudinaryId) : null}
          actualizado={fila ? formatDateTimePY(fila.updatedAt) : null}
          desdeEntorno={
            fila
              ? null
              : env
                ? { banco: env.banco, titular: env.titular, cuenta: env.cuenta }
                : null
          }
        />
      </div>
    </div>
  );
}
