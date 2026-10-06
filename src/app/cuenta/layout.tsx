import { notFound } from "next/navigation";
import type React from "react";

import { cuentasClientesHabilitadas } from "@/lib/cuentas";

/**
 * La puerta de `/cuenta/*` (PLAN.md FASE 2, PR E).
 *
 * Con `TIENDA.cuentasClientes` apagado —el default— toda esta rama del sitio
 * **no existe**: 404, no un 403 ni una pantalla que diga "no disponible". La
 * diferencia importa: un 403 anuncia que la feature está ahí y apagada, y una
 * tienda que decidió no tener cuentas de cliente no tiene por qué contarle a
 * nadie que el template las trae.
 *
 * Esto es la puerta, no el control: cada server action de `src/app/actions/
 * cuenta.ts` vuelve a mirar el flag en su primera línea, porque una acción es
 * un endpoint HTTP con su propio id y este layout no llega a correr.
 */
export const dynamic = "force-dynamic";

export default async function CuentaLayout({ children }: { children: React.ReactNode }) {
  if (!(await cuentasClientesHabilitadas())) notFound();
  return <>{children}</>;
}
