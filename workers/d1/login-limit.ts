import { sql } from "drizzle-orm";
import { getNativeDb } from "./database";
export { LOGIN_LIMIT, LOGIN_WINDOW_MS } from "../../src/lib/rate-limit";
type Result = { ok: boolean; remaining: number; retryAfterSeconds: number };
const keyDigest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((n) => n.toString(16).padStart(2, "0")).join("");

/** Shared atomic counters, including email and IP, across Worker isolates. */
export async function rateLimit(key: string, options: {limit: number; windowMs: number}, now = Date.now()): Promise<Result> {
  const digest = await keyDigest(key);
  const [row] = await getNativeDb().all<{ hits: number; starts: number }>(sql`
    INSERT INTO workers_login_limits (key, starts, hits)
    VALUES (${digest}, ${now}, 1)
    ON CONFLICT(key) DO UPDATE SET
      hits = CASE WHEN starts + ${options.windowMs} <= ${now} THEN 1 ELSE MIN(hits + 1, ${options.limit + 1}) END,
      starts = CASE WHEN starts + ${options.windowMs} <= ${now} THEN ${now} ELSE starts END
    RETURNING hits, starts
  `);
  if (!row) throw new Error("D1_STAGING_LOGIN_LIMIT_UNAVAILABLE");
  return {ok: row.hits <= options.limit, remaining: Math.max(0, options.limit-row.hits), retryAfterSeconds: row.hits <= options.limit ? 0 : Math.max(1, Math.ceil((row.starts + options.windowMs-now)/1000))};
}
export async function resetRateLimitKey(key: string) {
  const digest = await keyDigest(key);
  await getNativeDb().run(sql`DELETE FROM workers_login_limits WHERE key = ${digest}`);
}
export function clientIp(headers: Headers) { return headers.get("cf-connecting-ip") || "local-preview"; }
