/** Fictional visual price, never a commercial offer or checkout amount. */
export const LOCAL_DEMO_PRICE_PYG = 149000;

/** Preview requires an explicit opt-in AND a loopback disposable database. */
export function isLocalCatalogPreview(): boolean {
  if (process.env.LOCAL_CATALOG_PREVIEW !== "1") return false;
  try {
    const db = new URL(process.env.DATABASE_URL ?? "");
    const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
    const loopback = (host: string) =>
      ["127.0.0.1", "localhost", "[::1]"].includes(host);
    return (
      loopback(db.hostname) &&
      loopback(site.hostname) &&
      /preview_test$/i.test(db.pathname)
    );
  } catch {
    return false;
  }
}
