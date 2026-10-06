import "../src/lib/load-env";

import { safeError } from "../src/lib/safe-error";

import { closePool } from "../src/db";
import { backfillManualPayments } from "../src/domain/manual-payments";
import { formatGs } from "../src/lib/money";

/**
 * `pnpm backfill:pagos-manuales` — completa los pagos que nunca se registraron
 * (TASKS.md §27).
 *
 * Desde ahora toda transferencia aprobada y todo contra entrega confirmado
 * escriben su fila de `payments` en la misma transacción que cobra el pedido.
 * Los pedidos cobrados **antes** de ese cambio no la tienen, y la
 * reconciliación —que ya no acota el control a `tarjeta`— los va a reportar
 * hasta que alguien los complete. Eso es este script.
 *
 * Ensayo por defecto: sin `--apply` sólo imprime lo que haría. Es plata; el
 * dueño mira la lista primero.
 *
 * Idempotente: la fila se identifica por `UNIQUE(provider, provider_ref)` con
 * el número de pedido como referencia, así que correrlo dos veces no duplica
 * nada y correrlo después de un corte termina lo que faltaba.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const { pending, inserted } = await backfillManualPayments({ apply });

  if (pending.length === 0) {
    console.log(
      "✓ No hay pedidos cobrados sin fila de pago: no hay nada que completar."
    );
    return;
  }

  console.log(`${pending.length} pedido(s) cobrado(s) sin fila de pago:\n`);
  for (const row of pending) {
    console.log(
      `  ${row.orderNumber} (${row.orderStatus}, ${row.paymentMethod}) → ` +
        `payments(provider=${row.provider}, provider_ref=${row.orderNumber}, ` +
        `${formatGs(row.amountPyg)})`
    );
  }

  if (!apply) {
    console.log(
      "\nEnsayo: no se escribió nada. Volvé a correrlo con --apply para aplicarlo."
    );
    return;
  }

  console.log(`\n✓ ${inserted} fila(s) de pago escritas.`);
  if (inserted !== pending.length) {
    // Alguien cobró o completó un pedido mientras esto corría. No es un error
    // —el índice único hizo su trabajo— pero conviene que se vea.
    console.log(
      `  (${pending.length - inserted} ya tenían su fila cuando se escribió: ` +
        `las escribió otro proceso en el medio.)`
    );
  }
}

main()
  .catch((error) => {
    console.error("El backfill falló:", safeError(error).message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
