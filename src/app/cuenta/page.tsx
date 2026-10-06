import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CustomerProfileForm } from "@/components/cuenta/profile-form";
import { CustomerPasswordForm } from "@/components/cuenta/password-form";
import { CustomerLogoutButton } from "@/components/cuenta/logout-button";
import { findCustomerByPhone, listCustomerOrders } from "@/domain/customers";
import { orderUrl } from "@/domain/order-access";
import { currentCustomer } from "@/lib/customer-session";
import { t } from "@/i18n";
import { formatGs } from "@/lib/money";
import { ORDER_STATUS_LABEL_COMPRADOR } from "@/lib/order-labels";
import { formatDateTimePY, formatPhonePY } from "@/lib/py";

export const metadata: Metadata = {
  title: t("cuenta.meta"),
  // Los links a pedidos llevan el token en la URL: fuera de los buscadores.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CuentaPage() {
  const actor = await currentCustomer();
  if (!actor) redirect("/cuenta/entrar");

  const [customer, orders] = await Promise.all([
    findCustomerByPhone(actor.phone),
    listCustomerOrders(actor.customerId),
  ]);

  if (!customer) redirect("/cuenta/entrar");

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">
          {t("cuenta.hola", { nombre: customer.name })}
        </h1>
        <CustomerLogoutButton />
      </div>

      <section className="mt-6">
        <h2 className="font-medium">{t("cuenta.pedidos")}</h2>

        {orders.length === 0 ? (
          <p className="text-muted-foreground border-border mt-2 rounded-xl border border-dashed p-8 text-center text-sm">
            {t("cuenta.pedidos.vacio")}
            <br />
            <Link href="/" className="underline">
              {t("cuenta.pedidos.mira")}
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-2 grid gap-3">
            {orders.map((order) => (
              <li key={order.id} className="border-border rounded-xl border">
                <Link
                  href={orderUrl(order.orderNumber, order.accessToken)}
                  className="hover:bg-muted/50 block p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium tabular-nums">
                      {order.orderNumber}
                    </span>
                    <span className="text-sm">
                      {ORDER_STATUS_LABEL_COMPRADOR[order.status]}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 flex justify-between gap-4 text-xs">
                    <span>{formatDateTimePY(order.createdAt)}</span>
                    <span className="tabular-nums">
                      {formatGs(order.totalPyg)}
                    </span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/*
          Los pedidos que hiciste como invitada antes de tener cuenta no
          aparecen acá, y decirlo es mejor que dejar que alguien crea que
          perdimos su compra. Aparecerán cuando podamos comprobar que el
          WhatsApp es tuyo — ver `listCustomerOrders`.
        */}
        {customer.phoneVerifiedAt ? null : (
          <p className="text-muted-foreground mt-3 text-xs">
            {t("cuenta.pedidos.invitada")}
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-medium">{t("cuenta.datos")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("cuenta.datos.whatsapp")}{" "}
          <span className="tabular-nums">{formatPhonePY(customer.phone)}</span>
          <span className="block text-xs">
            {t("cuenta.datos.whatsappNota")}
          </span>
        </p>

        <div className="mt-4">
          <CustomerProfileForm
            defaults={{
              name: customer.name,
              email: customer.email ?? "",
              marketingOptIn: customer.marketingOptIn === true,
            }}
          />
        </div>
      </section>
      <CustomerPasswordForm required={!customer.hasPassword} />
    </main>
  );
}
