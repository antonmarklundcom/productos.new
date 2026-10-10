/** Redirect only the configured live apex/www pair; preview hosts stay independent. */
export function canonicalDomainResponse(request, env) {
  let expected;
  try { expected = new URL(env.NEXT_PUBLIC_SITE_URL); } catch { return null; }
  if (expected.protocol !== "https:" || expected.username || expected.password ||
      expected.port || expected.pathname !== "/" || expected.search || expected.hash ||
      expected.hostname.startsWith("www.") || expected.hostname.endsWith(".workers.dev") ||
      expected.hostname.endsWith(".invalid")) return null;
  const actual = new URL(request.url);
  if (![expected.hostname, `www.${expected.hostname}`].includes(actual.hostname)) return null;
  if (actual.origin === expected.origin) return null;
  const headers = {"cache-control":"private, no-store", "x-robots-tag":"noindex"};
  // Never forward a form/Server Action submitted to the non-canonical origin.
  if (!["GET", "HEAD"].includes(request.method))
    return new Response("Use the canonical HTTPS origin for this request.", {status:421, headers});
  const target = new URL(expected.origin);
  target.pathname = actual.pathname;
  target.search = actual.search;
  return new Response(null, {status:308, headers:{...headers, location:target.href}});
}
