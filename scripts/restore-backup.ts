import "@/lib/load-env";

import { closePool } from "@/db";
import { restoreBackup } from "@/domain/restore-backup";
import { safeError } from "@/lib/safe-error";

/**
 * `pnpm restore -- <archivo.jsonl.gz>` — reconstruye una base desde un backup
 * de `src/domain/backup.ts` (plan-operacion §5.4 A).
 *
 * ### El candado, que es lo más importante de este archivo
 *
 * **Sólo corre contra una base cuyo nombre contenga `restore` o `test`.** Es
 * el mismo candado que `tests/global-setup.ts` le pone a `TEST_DATABASE_URL`,
 * y exige que esté vacía. No elimina datos existentes: se recupera en una
 * base aislada y se revisa antes del cambio de conexión de la tienda.
 *
 * Restaurar en producción no es un `pnpm restore` con otro flag: es crear una
 * base nueva llamada `tienda_restore`, restaurar ahí, mirar que esté todo, y
 * recién entonces cambiar `DATABASE_URL`. Esa fricción es a propósito.
 *
 * ### El orden
 *
 * Valida primero el archivo completo y su versión; carga en una única
 * conexión/transacción y verifica explícitamente las FK antes del commit.
 */

export type Opciones = { archivo: string; vaciar: boolean; legacy?: boolean };

export function parseArgs(argv: string[]): Opciones {
  const args = argv.filter((arg) => arg !== "--");
  const archivo = args.find((arg) => !arg.startsWith("--"));
  if (!archivo) {
    throw new Error(
      "Falta el archivo: pnpm restore -- backups/backup-2026-08-12T0300.jsonl.gz"
    );
  }
  return {
    archivo,
    vaciar: !args.includes("--sin-vaciar"),
    legacy: args.includes("--legacy"),
  };
}

/**
 * El candado. Exportado para poder testearlo sin tocar ninguna base.
 *
 * Se mira el **nombre de la base**, no la URL entera: un host llamado
 * `test.hostinger.com` no convierte a `tienda_produccion` en una base de
 * pruebas.
 */
export function baseEsRestaurable(url: string): boolean {
  try {
    const nombre = new URL(url).pathname.replace(/^\//, "");
    return nombre !== "" && /restore|test/i.test(nombre);
  } catch {
    return false;
  }
}

export { leerBackup } from "@/domain/restore-backup";

export async function restaurar(opciones: Opciones) {
  if (!baseEsRestaurable(process.env.DATABASE_URL ?? ""))
    throw new Error("La base destino debe contener restore o test");
  return restoreBackup(opciones);
}

async function main(): Promise<void> {
  const opciones = parseArgs(process.argv.slice(2));
  const reporte = await restaurar(opciones);
  if (reporte.keyMatches === false)
    console.warn(
      "SESSION_SECRET no coincide: las credenciales cifradas requieren la clave original"
    );
  if (reporte.legacy)
    console.warn(
      "Formato antiguo: verificar la versión del esquema y ejecutar pnpm reconcile antes del cambio de base"
    );
  console.log(`✓ ${reporte.filas} filas en ${reporte.tablas} tablas`);
  console.log(
    `Credenciales recuperadas: ${reporte.decryptedSecrets}/${reporte.secrets}. Reconciliación: ${reporte.reconciliation.ok ? "OK" : "REVISAR"}`
  );
  if (
    !reporte.reconciliation.ok ||
    reporte.decryptedSecrets !== reporte.secrets ||
    reporte.keyMatches === false
  ) {
    console.error(
      "La carga terminó en la base de recuperación, pero la verificación requiere revisión. No cambiar DATABASE_URL hasta resolverla."
    );
    process.exitCode = 1;
  }
  await closePool();
}

// Sólo cuando se lo corre como script, no cuando lo importa un test.
if (process.argv[1]?.includes("restore-backup")) {
  main().catch(async (error) => {
    console.error(safeError(error).message);
    await closePool();
    process.exit(1);
  });
}
