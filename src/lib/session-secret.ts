/** Shared by runtime cookies, OTP and preflight. Safe to import from the proxy. */
export function validSessionSecret(
  secret: string | undefined
): secret is string {
  return Boolean(
    secret &&
    secret.trim().length >= 32 &&
    !/changeme|generate|placeholder|replace.?me/i.test(secret)
  );
}
