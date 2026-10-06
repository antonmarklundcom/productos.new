import type { Metadata } from "next";

import { OrderLookupForm } from "@/components/order-lookup-form";
import { t } from "@/i18n";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("buscarPedido.meta"),
  robots: { index: false },
};

export default function OrderLookupPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{t("buscarPedido.titulo")}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{t("buscarPedido.bajada")}</p>

      <div className="mt-6">
        <OrderLookupForm />
      </div>
    </main>
  );
}
