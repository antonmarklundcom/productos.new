import { AsyncLocalStorage } from "node:async_hooks";
import type { Database } from "./index";

/** Only the Workers entry supplies this scope. Hostinger keeps its existing pool. */
const requestDatabase = new AsyncLocalStorage<Database>();

export function currentRequestDatabase(): Database | undefined {
  return requestDatabase.getStore();
}

export function withRequestDatabase<T>(database: Database, operation: () => T): T {
  return requestDatabase.run(database, operation);
}
