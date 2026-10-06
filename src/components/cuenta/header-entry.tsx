import Link from "next/link";

import { cuentasClientesHabilitadas } from "@/lib/cuentas";
import { currentCustomer } from "@/lib/customer-session";
import { t } from "@/i18n/client";

/**
 * La entrada a la cuenta en el header (PLAN.md FASE 2, PR E.4).
 *
 * **Discreta a propósito.** Un botón de "Iniciar sesión" grande al lado del
 * carrito le sugiere a quien nunca compró acá que hace falta una cuenta, que
 * es exactamente lo contrario de lo que esta tienda quiere decir. Es un link
 * de texto, del tamaño del resto del header, y no compite con el carrito.
 *
 * Con el flag apagado devuelve `null` y el header queda **byte-idéntico** al
 * de antes de esta feature. Con el flag prendido pero sin
 * `CUSTOMER_SESSION_SECRET` configurado, `currentCustomer()` devuelve null y
 * se ofrece "Entrar" — que va a fallar con un error claro del servidor. Es
 * deliberado: una tienda que prendió el flag y no puso el secreto tiene que
 * enterarse, no quedarse con una feature silenciosamente rota.
 */
export async function CuentaHeaderEntry() {
  if (!(await cuentasClientesHabilitadas())) return null;

  const customer = await currentCustomer();

  return (
    <Link
      href={customer ? "/cuenta" : "/cuenta/entrar"}
      className="text-muted-foreground hover:text-foreground shrink-0 text-sm whitespace-nowrap transition-colors"
    >
      {customer ? t("cuenta.header.miCuenta") : t("cuenta.header.entrar")}
    </Link>
  );
}
