import "../src/lib/load-env";

import { safeError } from "../src/lib/safe-error";

import { closePool } from "../src/db";
import { reconcile } from "../src/domain/reconciliation";
import { formatGs } from "../src/lib/money";

/**
 * `pnpm reconcile` — control de caja (PLAN.md 4.10).
 *
 * Se corre a mano después de un deploy, o desde el cron nocturno de Hostinger.
 * Sale con código 1 si algo no cuadra, para que el cron mande el mail solo.
 *
 * Dos capas: la aritmética de cada pedido y los controles cruzados entre
 * tablas. Se imprimen los cruzados primero — un pedido cobrado sin pago
 * registrado se atiende antes que un guaraní de diferencia en un subtotal.
 */
async function main(): Promise<void> {
  const report = await reconcile();

  if (report.ok) {
    console.log(
      "✓ Todo cuadra: totales, líneas y las invariantes entre tablas."
    );
    return;
  }

  if (report.crossChecks.length > 0) {
    console.error(
      `\n✗ ${report.crossChecks.length} inconsistencia(s) entre tablas:\n`
    );
    for (const finding of report.crossChecks) {
      console.error(
        `  [${finding.kind}] ${finding.orderNumber} (${finding.orderStatus})`
      );
      console.error(`    ${finding.detail}`);
    }
  }

  if (report.totalMismatches.length > 0) {
    console.error(
      `\n✗ ${report.totalMismatches.length} pedido(s) con totales descuadrados:\n`
    );
    for (const row of report.totalMismatches) {
      console.error(
        `  ${row.orderNumber} (${row.status})\n` +
          `    subtotal guardado ${formatGs(row.storedSubtotalPyg)} vs ítems ${formatGs(row.itemsSubtotalPyg)} (dif ${row.subtotalDiffPyg})\n` +
          (row.discountPyg > 0
            ? `    descuento         ${formatGs(row.discountPyg)}\n`
            : "") +
          `    total guardado    ${formatGs(row.storedTotalPyg)} vs esperado ${formatGs(row.expectedTotalPyg)} (dif ${row.totalDiffPyg})`
      );
    }
  }

  if (report.lineMismatches.length > 0) {
    console.error(
      `\n✗ ${report.lineMismatches.length} línea(s) con line_total ≠ precio × cantidad:\n`
    );
    for (const line of report.lineMismatches) {
      console.error(
        `  ${line.orderNumber} · ${line.skuSnapshot}: ` +
          `${formatGs(line.unitPricePyg)} × ${line.qty} = ${formatGs(line.expectedLineTotalPyg)}, ` +
          `guardado ${formatGs(line.storedLineTotalPyg)}`
      );
    }
  }

  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("La reconciliación falló:", safeError(error).message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
