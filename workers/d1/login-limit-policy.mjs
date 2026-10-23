// Recovery uses one hour; login uses fifteen minutes. Keep expired login rows
// until the longest supported window has ended, including recovery counters.
export const MAX_LOGIN_WINDOW_MS = 60 * 60 * 1000;
export const LOGIN_CLEANUP_BATCH = 32;
export async function pruneLoginLimits(db, now) {
  await db.prepare(`DELETE FROM workers_login_limits WHERE key IN (
    SELECT key FROM workers_login_limits WHERE starts <= ? ORDER BY starts LIMIT ?
  )`).bind(now - MAX_LOGIN_WINDOW_MS, LOGIN_CLEANUP_BATCH).run();
}
