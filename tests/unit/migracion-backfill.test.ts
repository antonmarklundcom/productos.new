import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REFUNDS_LEDGER_BACKFILL } from '@/db/backfills';

/**
 * El backfill que se testea y el que corre en producción son el mismo SQL.
 *
 * `tests/integration/refunds-backfill.test.ts` ejercita la constante de
 * `src/db/backfills.ts`, porque contra una base ya migrada no hay forma de
 * "correr la migración de nuevo" con datos adentro. Eso deja una grieta: si
 * alguien edita el `.sql` a mano —o el `.ts` y no el `.sql`— el test seguiría
 * verde y la migración real haría otra cosa.
 *
 * Este test cierra la grieta. Es el único lugar donde se afirma que el
 * archivo de migración contiene las sentencias **textualmente**.
 */

const DRIZZLE_DIR = path.join(process.cwd(), 'drizzle');

async function migracionQueBackfillea(): Promise<{ file: string; sql: string }> {
  const archivos = (await readdir(DRIZZLE_DIR))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const conBackfill: Array<{ file: string; sql: string }> = [];
  for (const file of archivos) {
    const sql = await readFile(path.join(DRIZZLE_DIR, file), 'utf8');
    if (sql.includes('REFUNDS_LEDGER_BACKFILL')) conBackfill.push({ file, sql });
  }

  // Exactamente una: el backfill se escribió una sola vez, en 0012. Si
  // apareciera en dos migraciones, correría dos veces — es idempotente, pero
  // que esté duplicado sería un error de copiado que queremos ver.
  expect(conBackfill.map((m) => m.file)).toHaveLength(1);
  return conBackfill[0]!;
}

describe('el backfill de la migración 0012', () => {
  it('está en una sola migración y es la 0012', async () => {
    const { file } = await migracionQueBackfillea();
    expect(file).toMatch(/^0012_/);
  });

  it('contiene textualmente las sentencias de src/db/backfills.ts', async () => {
    const { sql } = await migracionQueBackfillea();
    expect(REFUNDS_LEDGER_BACKFILL.length).toBeGreaterThan(0);
    for (const statement of REFUNDS_LEDGER_BACKFILL) {
      expect(sql).toContain(statement);
    }
  });

  it('cada sentencia queda cerrada con `;` en el archivo', async () => {
    // El migrador de drizzle parte por `--> statement-breakpoint`, pero un
    // `db:push` o un pegado a mano en un cliente de MySQL no: una sentencia
    // sin cerrar se come la siguiente.
    const { sql } = await migracionQueBackfillea();
    for (const statement of REFUNDS_LEDGER_BACKFILL) {
      expect(sql).toContain(`${statement};`);
    }
  });
});
