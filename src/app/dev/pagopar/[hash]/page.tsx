import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { orders, payments } from "@/db/schema";
import { orderUrl } from "@/domain/order-access";
import { simulateMockPayment, type MockWebhookInput } from "@/domain/pagopar/mock";
import { assertMockAllowed, isPagoparMockMode } from "@/domain/pagopar/mode";
import { formatGs } from "@/lib/money";

/**
 * Pasarela de Pagopar simulada (`PAGOPAR_MODE=mock`).
 *
 * Es la pantalla a la que el checkout manda al comprador cuando el simulador
 * está encendido, en el lugar de la página de pago alojada por Pagopar. Sirve
 * para demostrar el ciclo completo del pedido sin una cuenta de Pagopar, y
 * también para provocar a mano los casos feos —aviso repetido, monto que no
 * coincide, firma inválida— que en producción sólo se ven en un incidente.
 *
 * Ninguno de esos botones toca la base directamente: todos disparan un aviso
 * firmado contra la ruta real `POST /api/webhooks/pagopar` (ver `mock.ts`), o
 * sea que el estado del pedido sigue moviéndose por el único camino que
 * existe, `transitionOrder()`.
 *
 * Fuera del modo mock la ruta no existe: 404. En producción
 * `isPagoparMockMode()` devuelve `false` pase lo que pase (`mode.ts`), así que
 * ese 404 es total.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pagopar (simulado)",
  robots: { index: false, follow: false },
};

type Params = Promise<{ hash: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Los escenarios que ofrece la pantalla, con lo que cambian del aviso. */
const SCENARIOS = {
  pagar: {
    label: "Pagar",
    hint: "Aviso de pago acreditado con el monto correcto. El pedido pasa a «pagado».",
  },
  repetir: {
    label: "Reenviar el mismo aviso",
    hint: "Idéntico al anterior: lo frena la idempotencia (payment_events) y no cambia nada.",
  },
  rechazar: {
    label: "Rechazar el pago",
    hint: "`pagado: false`. Queda el rastro y el pedido sigue esperando.",
  },
  monto_distinto: {
    label: "Pagar de menos",
    hint:
      "Monto que no coincide con el total: 409 y el pedido no se toca. " +
      "Probalo antes de pagar — después lo frena primero la idempotencia.",
  },
  firma_invalida: {
    label: "Aviso sin firma válida",
    hint: "Como lo mandaría cualquiera desde internet: 401 antes de mirar el cuerpo.",
  },
} as const;

type ScenarioKey = keyof typeof SCENARIOS;

function isScenario(value: string): value is ScenarioKey {
  return Object.hasOwn(SCENARIOS, value);
}

export default async function PagoparMockPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  if (!isPagoparMockMode()) notFound();

  const { hash } = await params;
  const hashPedido = decodeURIComponent(hash);
  const query = await searchParams;

  const order = await findOrderByHash(hashPedido);
  if (!order) notFound();

  async function simulate(formData: FormData): Promise<void> {
    "use server";

    // El guard de `mode.ts` otra vez, del lado del servidor: una server action
    // es un endpoint POST y no alcanza con que la página no se haya renderizado.
    assertMockAllowed("POST /dev/pagopar (server action)");
    if (!isPagoparMockMode()) notFound();

    const raw = String(formData.get("escenario") ?? "");
    if (!isScenario(raw)) notFound();

    const target = await findOrderByHash(hashPedido);
    if (!target) notFound();

    const input: MockWebhookInput = {
      hashPedido,
      montoPyg: raw === "monto_distinto" ? Math.max(0, target.totalPyg - 1000) : target.totalPyg,
      pagado: raw !== "rechazar",
      firmaInvalida: raw === "firma_invalida",
    };

    const result = await simulateMockPayment(input);

    redirect(
      `/dev/pagopar/${encodeURIComponent(hashPedido)}?escenario=${raw}&estado=${result.status}`
    );
  }

  const lastScenario = firstValue(query.escenario);
  const lastStatus = firstValue(query.estado);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Pagopar simulado · PAGOPAR_MODE=mock
        </p>
        <h1 className="text-xl font-semibold tracking-tight">Pedido {order.orderNumber}</h1>
        <p className="text-muted-foreground text-sm">
          Esta pantalla reemplaza a la página de pago de Pagopar. No hay red, no hay credenciales y
          no entra plata: cada botón postea un aviso de pago firmado contra la ruta real del
          webhook.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-4 text-sm">
        <dt className="text-muted-foreground">Total del pedido</dt>
        <dd className="text-right font-medium">{formatGs(order.totalPyg)}</dd>
        <dt className="text-muted-foreground">Estado del pedido</dt>
        <dd className="text-right font-medium">{order.status}</dd>
        <dt className="text-muted-foreground">Estado del pago</dt>
        <dd className="text-right font-medium">{order.paymentStatus}</dd>
        <dt className="text-muted-foreground">hash_pedido</dt>
        <dd className="text-right font-mono text-xs break-all">{hashPedido}</dd>
      </dl>

      {lastScenario && isScenario(lastScenario) ? (
        <p className="rounded-lg border p-3 text-sm">
          Último aviso: <span className="font-medium">{SCENARIOS[lastScenario].label}</span> → la
          ruta contestó <span className="font-mono">{lastStatus}</span>.
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {Object.entries(SCENARIOS).map(([key, scenario]) => (
          <form key={key} action={simulate} className="flex flex-col gap-1">
            <input type="hidden" name="escenario" value={key} />
            <button
              type="submit"
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium"
            >
              {scenario.label}
            </button>
            <span className="text-muted-foreground text-xs">{scenario.hint}</span>
          </form>
        ))}
      </div>

      <Link
        href={orderUrl(order.orderNumber, order.accessToken)}
        className="text-primary text-sm font-medium underline"
      >
        Ver la página del pedido
      </Link>
    </main>
  );
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

async function findOrderByHash(hashPedido: string) {
  const trimmed = hashPedido.trim();
  if (trimmed === "") return null;

  const rows = await getDb()
    .select({
      orderNumber: orders.orderNumber,
      accessToken: orders.accessToken,
      status: orders.status,
      totalPyg: orders.totalPyg,
      paymentStatus: payments.status,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(payments.provider, "pagopar"), eq(payments.providerRef, trimmed)))
    .limit(1);

  return rows[0] ?? null;
}
