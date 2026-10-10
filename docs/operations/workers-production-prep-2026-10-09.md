# Workers production preparation — 9 October 2026

This extends draft PR14 on codex/workers-staging-20261009. It does not switch productos.com.py, merge main, migrate production data or reupload R2 images.

## Catalog reconciliation

Read-only staging D1 query:262products,9categories,821images,0users,0orders. All262variant SKUs match the selected fixture in C:/dev/workers-local-productos/catalog-public.json; name, slug, retail price, category, image count, enquiry mode and price visibility match. The live public sitemap lists the identical262product URLs. This does not verify all current live retail values through an authenticated export.

The entire6609-row captured catalog-latest.csv was read and matched by DropiID. All262selected IDs have captured supplier cost; none had zero captured stock or retail at/below that cost. These are captured source facts, not live supplier checks. Stock/cost/retail values were not overwritten. Known sharpener IDs13535,9710,15839 remain a product-identity review, not proof of three distinct products.

Evidence: E:/ai work/Artifacts/productos.new/2026-10-09/production-prep/CATALOG-AUDIT.json and CAPTURED-COST-RECONCILIATION.json. Read-only command from this checkout: pnpm exec tsx scripts/reconcile-workers-catalog.mts <artifact-directory>. The currently selected fixture path is a CLI-only local source; resolve it with the storage map before moving anything.

## Public catalog cache and SEO

Product cards disable prefetch, reducing unsolicited dynamic product requests. WORKERS_PUBLIC_CACHE_SECONDS=60 enables bounded Cache API HTML caching only for anonymous GET home/product/category requests without cookies, authorization, RSC/navigation headers, query strings, conditionals, range or explicit no-cache. Private/no-store responses, Set-Cookie, redirects, errors, non-HTML and unsupported Vary fields bypass. Admin/contact/search/API/actions never share that cache. Version metadata partitions entries on each deployment. Browsers revalidate; eligible edge HTML may be up to60seconds old. Cache infrastructure failures fall back to rendering. This remains an enquiry-only pilot with checkout/stock mutations blocked; do not reuse this policy for purchasing without reviewing invalidation and reservation semantics.

The Worker still executes for Cache API hits, so hits reduce render/DB CPU but are not automatically free requests. Hosted cache-hit evidence must be recorded after deployment; local mock tests are not a speed benchmark.

WORKERS_PRODUCTION_READY remains false. Staging robots/noindex remain active. The production switch only permits public indexing when the request origin matches a valid configured HTTPS NEXT_PUBLIC_SITE_URL outside workers.dev. Admin/auth remain noindex/private even with that switch. Before domain activation, use the real production URL for the build/runtime, verify canonical/sitemap/OG links and actual indexability, and verify backups/admin/contact. No production domain or DB config has been activated by this document.

## Admin login

No staging user exists. Production passwords cannot be read back; the source credential record is not available locally. The owner explicitly requested reusing the live login, which may be entered privately during staging account creation. From the existing checkout:

```powershell
cd C:/Projects/productos-workers-staging
pnpm workers:create-owner
```

Enter the same admin email and, if it meets the12-character requirement, the same password privately when prompted. Password entry is hidden; no plaintext credential enters chat/files/arguments. This creates a separate staging owner, never resets an existing owner and does not change Hostinger. Open https://productos-workers-staging.marklundfaktura.workers.dev/admin/login afterward. Once the owner exists, authenticated save/category/supplier acceptance remains required; the disposable low-level test that assumes zero users must not run.

## Outstanding provider and contact inputs

GitHub CI was green before this change; the separate Cloudflare automatic build49145139-23e0-4968-ba16-c7fa8dcbc6b8 failed. Dashboard loading stalled and browser control timed out; available Builds API was previously403/code12004. The substantive Building/Deploying error is still needed. Direct deployment success is not an automatic-build fix.

Live/contacto returned200 but had no wa.me or mailto links. Business WhatsApp and public email must come from the owner; no personal account email or invented phone is substituted. Contact/WhatsApp CTA completion is pending that input. Preserve truthful policies; no invented shipping terms, address or operating hours.

Domain cutover is a later step: bind the reviewed production Worker as a Cloudflare Custom Domain, replacing the Hostinger website records through the supported flow. Keep imagenes R2/email/nameservers untouched. Verify apex/www redirect, TLS, home/category/product/contact/admin, R2 gallery and production revision. Rollback restores the recorded Hostinger CDN targets with DNS-only, but does not undo D1 writes. Leave PR14 draft/unmerged while authenticated acceptance and automatic deployment remain unresolved.
