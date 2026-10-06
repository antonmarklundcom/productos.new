import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getOrderByPagoparHash, orderUrl } from "@/domain/order-access";
import { t } from "@/i18n";

/**
 * Página de retorno de Pagopar (PLAN.md 5.5).
 *
 * Pagopar manda al comprador de vuelta acá después de pagar (o de abandonar
 * el pago), con el `hash_pedido` en la query. Esta página no decide nada
 * sobre el estado del pedido — eso lo hace únicamente el webhook
 * (`POST /api/webhooks/pagopar`, ARCH.md §4), que puede llegar antes o
 * después que el comprador vuelva. Lo único que hace acá es ubicar el pedido
 * por ese hash y mandar a la página tokenizada de siempre, que ya muestra el
 * estado real con polling — no se construye una vista de estado nueva.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("pagopar.meta"),
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function PagoparRetornoPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const query = await searchParams;
  // `hash_pedido` es el nombre que usa Pagopar en todo lo demás (protocol.ts);
  // `hashPedido` queda como alias por si el redirect llega con otra casing.
  const hashPedido = firstValue(query.hash_pedido) || firstValue(query.hashPedido);

  const order = hashPedido ? await getOrderByPagoparHash(hashPedido) : null;

  if (order) {
    redirect(orderUrl(order.orderNumber, order.accessToken));
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{t("pagopar.noEncontrado")}</h1>
      <p className="text-muted-foreground text-sm">{t("pagopar.noEncontrado.texto")}</p>
      <Link href="/pedido/buscar" className="text-primary text-sm font-medium underline">
        {t("pagopar.buscar")}
      </Link>
    </main>
  );
}
