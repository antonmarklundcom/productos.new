const pendingOperations = new Map<
  string,
  { fingerprint: string; key: string }
>();
/** Persist only a digest and random key, so a lost response survives reload. */
export async function browserOperation(
  scope: string,
  payload: unknown
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const fingerprint = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
  const existing = pendingOperations.get(scope);
  if (existing?.fingerprint === fingerprint) return existing.key;
  const slot = `ecom:operation:${scope}`;
  try {
    const saved = JSON.parse(sessionStorage.getItem(slot) ?? "null");
    if (saved?.fingerprint === fingerprint && typeof saved.key === "string")
      return saved.key;
  } catch {
    /* Private-mode storage can be unavailable. */
  }
  const key = crypto.randomUUID();
  pendingOperations.set(scope, { fingerprint, key });
  try {
    sessionStorage.setItem(slot, JSON.stringify({ fingerprint, key }));
  } catch {
    /* Current request still has a random capability. */
  }
  return key;
}
export function finishBrowserOperation(scope: string): void {
  pendingOperations.delete(scope);
  try {
    sessionStorage.removeItem(`ecom:operation:${scope}`);
  } catch {
    /* No storage. */
  }
}
