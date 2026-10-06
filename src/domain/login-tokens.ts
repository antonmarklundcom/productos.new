import { createHmac, hkdfSync, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { withLockRetry } from "@/db/retry";
import { customers, loginTokens } from "@/db/schema";
import { normalizePhonePY } from "@/lib/py";
import { validSessionSecret } from "@/lib/session-secret";
import type { MessageKey, Params } from "@/i18n";
import { DomainError } from "./errors";
import type { Executor } from "./executor";
import type { MessageChannel } from "./messaging";

export const LOGIN_TOKEN_TTL_MS = 10 * 60 * 1000;
export const LOGIN_TOKEN_MAX_ATTEMPTS = 5;
export class LoginTokenError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = "LoginTokenError";
  }
}
export function generateLoginCode(): string {
  return String(randomInt(1_000_000)).padStart(6, "0");
}

/** Phone-bound HMAC prevents searching the six-digit space from a leaked DB. */
export function hashLoginCode(customerId: number, code: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!validSessionSecret(secret)) throw new Error("SESSION_SECRET inválido");
  const key = Buffer.from(
    hkdfSync("sha256", secret, "ecom/login-code/v1", "challenge", 32)
  );
  return createHmac("sha256", key)
    .update(`${customerId}:${code.trim()}`)
    .digest("hex");
}
export async function issueLoginToken(
  customerId: number,
  channel: MessageChannel,
  executor?: Executor
): Promise<{ code: string; expiresAt: Date }> {
  const run = async (tx: Executor) => {
    // Same first lock as consume: issuance never leaves two live challenges.
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, customerId))
      .for("update");
    if (!customer?.isActive)
      throw new LoginTokenError("error.cuenta.codigoNoPude");
    await tx
      .update(loginTokens)
      .set({ invalidatedAt: sql`NOW()` })
      .where(
        and(
          eq(loginTokens.customerId, customerId),
          isNull(loginTokens.consumedAt),
          isNull(loginTokens.invalidatedAt)
        )
      );
    const code = generateLoginCode();
    const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_MS);
    await tx
      .insert(loginTokens)
      .values({
        customerId,
        tokenHash: hashLoginCode(customerId, code),
        channel,
        expiresAt,
      });
    return { code, expiresAt };
  };
  return executor
    ? run(executor)
    : withLockRetry(() => getDb().transaction(run));
}
export type ConsumedToken = {
  customerId: number;
  passwordResetRequired: boolean;
};

/** A code alone never identifies an account. Attempts survive process restarts. */
export async function consumeLoginToken(
  phone: string,
  code: string
): Promise<ConsumedToken | null> {
  const normalized = normalizePhonePY(phone);
  if (!normalized || !/^\d{6}$/.test(code.trim())) return null;
  return withLockRetry(() =>
    getDb().transaction(async (tx) => {
      const [customer] = await tx
        .select()
        .from(customers)
        .where(eq(customers.phone, normalized))
        .for("update");
      if (!customer?.isActive) {
        timingSafeEqual(Buffer.alloc(64), Buffer.from(hashLoginCode(0, code)));
        return null;
      }
      const [token] = await tx
        .select()
        .from(loginTokens)
        .where(
          and(
            eq(loginTokens.customerId, customer.id),
            isNull(loginTokens.consumedAt),
            isNull(loginTokens.invalidatedAt),
            gt(loginTokens.expiresAt, new Date())
          )
        )
        .orderBy(desc(loginTokens.id))
        .limit(1)
        .for("update");
      if (!token) return null;
      const expected = Buffer.from(token.tokenHash);
      const actual = Buffer.from(hashLoginCode(customer.id, code));
      const attempts = token.attempts + 1;
      if (
        token.attempts >= LOGIN_TOKEN_MAX_ATTEMPTS ||
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      ) {
        await tx
          .update(loginTokens)
          .set({
            attempts,
            ...(attempts >= LOGIN_TOKEN_MAX_ATTEMPTS
              ? { invalidatedAt: sql`NOW()` }
              : {}),
          })
          .where(eq(loginTokens.id, token.id));
        return null;
      }
      await tx
        .update(loginTokens)
        .set({ consumedAt: sql`NOW()` })
        .where(eq(loginTokens.id, token.id));
      const firstVerification = customer.phoneVerifiedAt === null;
      await tx
        .update(customers)
        .set({
          phoneVerifiedAt: customer.phoneVerifiedAt ?? sql`NOW()`,
          lastLoginAt: sql`NOW()`,
          // The registrant never proved the phone. Discard their password and cookies.
          ...(firstVerification
            ? {
                passwordHash: null,
                sessionVersion: sql`${customers.sessionVersion} + 1`,
              }
            : {}),
        })
        .where(eq(customers.id, customer.id));
      return {
        customerId: customer.id,
        passwordResetRequired: firstVerification,
      };
    })
  );
}
export async function purgeLoginTokens(): Promise<void> {
  await getDb()
    .delete(loginTokens)
    .where(sql`${loginTokens.createdAt} < NOW() - INTERVAL 7 DAY`);
}
export function loginCodeMessage(code: string): string {
  return `${code} es tu código para entrar. Vence en 10 minutos. Si no lo pediste, ignorá este mensaje.`;
}
