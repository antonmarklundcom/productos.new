import type { Database } from '@/db';

type TransactionCallback = Parameters<Database['transaction']>[0];

/** El handle que Drizzle pasa adentro de `db.transaction(...)`. */
export type Tx = Parameters<TransactionCallback>[0];

/** Cualquier cosa capaz de correr queries: el pool o una transacción abierta. */
export type Executor = Database | Tx;
