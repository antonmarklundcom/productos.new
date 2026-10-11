# Productos migration findings — 10 October 2026

This is a dated evidence ledger, not a promise that all ecommerce/admin features are finished. It supersedes current-status summaries in older migration handovers; older reports retain their historical facts. No hosting, database, DNS or subscription changes were made to produce this documentation.

## Architecture and evidence anchors

- Repository: https://github.com/antonmarklundcom/productos.new ; local checkout C:/Projects/productos-workers-staging.
- Branch: codex/workers-staging-20261009. PR14 remains draft/unmerged: https://github.com/antonmarklundcom/productos.new/pull/14 . Main retains the Hostinger version.
- Latest documented source: 751dbbee42d76cd439046ca39eafcbe5b557f801. Automatic deployment version: 3dccef39-a0c7-425c-891a-5cad5710253a. [Automatic build](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/workers/services/view/productos-workers-staging/production/builds/bba3ce8f-130d-4e07-a192-de2f71ea95c3).
- Live https://productos.com.py ; admin https://productos.com.py/admin ; preview https://productos-workers-staging.marklundfaktura.workers.dev . The Worker still has “staging” in its name, but apex/www are live Worker Custom Domains.
- Vinext build/deploy: pnpm build:vinext / pnpm deploy:vinext, root /. Native D1 binding DB; existing R2 binding IMAGES, bucket productos-images, public origin https://imagenes.productos.com.py.
- Catalog: 262 published products, nine categories, 821 gallery photos. Prior recorded R2 inventory: 3,591 delivery objects totaling 125,256,916 bytes (about 119.5 MiB). D1 payload at cutover: 819,200 bytes. These are dated inventories, not fresh storage measurements on every invocation.
- D1 is independent of the retained Hostinger MariaDB. No automatic synchronization or reverse migration is installed. R2 objects were reused, not reuploaded for the host change.
- Existing Workers Paid/R2 subscriptions reused. No additional paid image platform or subscription was activated by this work.

## What is accepted, implemented or still absent

| Feature | Evidence/status as of this ledger |
| --- | --- |
| Home, nine categories, product/contact/policy pages | Cutover HTTP/navigation acceptance passed; later limited public probes returned 200 |
| Responsive phone gallery/menu, public price and WhatsApp | Phone 390px and desktop 1440px acceptance; five-image example and no horizontal overflow passed |
| Protected admin/login | Owner login accepted; public admin redirects to login; private responses no-store/noindex |
| Product edit/private supplier link | Existing product1 unchanged save/readback accepted; retail 69000 PYG, enquiry/public-price/category/publication/gallery/private link retained |
| Product/category/supplier admin | Implemented; category/supplier write scenarios were not newly accepted by the unchanged-product save |
| Dashboard/settings | Native dashboard fixed; unchanged settings save/reload accepted; atomic JSON-preserving UPSERT tested |
| CSV/Excel catalog imports and R2 gallery uploads | Implemented and source/build tested in 751dbbe; authenticated deployed import/upload acceptance still pending |
| Checkout, orders, payments, reservations/stock mutations | Not ported; must remain guarded until business correctness is tested |
| Accounts/admin extras/integration editing/jobs | Incomplete; pending menu entries are not working features |
| Recovery email | Recovery code exists, but verified sender/binding and real inbox/reset acceptance are missing; delivery is disabled |
| Catalog duplicates | Review pending, including sharpener Dropi IDs 13535, 9710, 15839; preserve supplier alternatives rather than blindly merging by title |

A prior report marked settings/import/uploads unported. Settings and native imports/uploads subsequently changed as above. Do not repeat that older status or claim the port is checkout-ready. Health cron:false reflects unported jobs; db:true verifies connectivity, not every operation.

## Incident ledger and reusable remedies

| Symptom | Evidence and diagnosis | Fix/lesson and limits |
| --- | --- | --- |
| Hostinger duplicate startups, resource pressure | Owner reported orphan Node copies and a shared 200 process/thread budget; owner cron reaper retained newest copies at configured thresholds | Moving Productos avoids its contribution to that host budget. Launcher/alias cause was suspected, not proven; other apps and their reaper were not repaired by this migration |
| 429/428 on public pages/admin | Owner observations plus Hostinger double-CDN documentation; apex/www previously proxied to Hostinger CDN | Apex/www were changed to DNS-only before migration; sampled pages later returned200. Capture headers/request IDs before attributing errors. Process shutdown, CDN throttling and challenge responses are separate hypotheses |
| Failed to find Server Action, deployment mismatch | Open forms used an action hash from an older deployment | Fresh navigation/form after deployment; distinguish stale-client failures from SQL failures. Do not reset passwords or rerun schema blindly |
| applyCatalogImport failed ER_BAD_FIELD_ERROR on Hostinger | App required products.sale_mode, show_price, dropi_url not present in live schema | Claude/owner completed that repair and recorded24 MySQL migrations. This ledger does not claim Codex performed it. Verify one write/readback after repair; do not rerun completed migrations |
| R2 public image environment missing | NEXT_PUBLIC_IMAGENES_UR was entered instead of NEXT_PUBLIC_IMAGENES_URL | Exact variable spelling matters; local upload credentials, host runtime values and compiled public variables are distinct |
| workers.dev still showed Hello World | Placeholder deployment was serving, despite repo/branch work | Confirm watched branch and deployed commit/version; deploying the actual app is separate from creating a Worker |
| Automatic Linux build failed but direct deploy worked | Error: Failed to resolve required runtime dependency "__CLOUDFLARE_MODULE__CompiledWasm__" for standalone output | Vinext inherited Next output:"standalone". Worker-specific config sets output:undefined while retained Hostinger config keeps standalone; preserve other settings and check a real Git build |
| Successful login followed by panel error Ref775227767 | Dashboard sent raw Date values through D1 binding; isolated login success separated credentials from dashboard failure | Native timestamp encoding and explicit Paraguay day boundaries fixed the dashboard. A sub12-character password was not the cause of that exception |
| Second owner creation refused | One active owner already existed; creation tool intentionally did not reset it | Use explicit hidden-input reset command for existing owner; do not create duplicates or paste passwords into chat. New/reset password policy is separate from authentication |
| Gallery present on server, disappeared on client | Browser hydration lacked the image origin in the public bundle | Reviewed public build values are inlined; test all gallery images after hydration at phone width. Runtime-only configuration cannot repair a stale client bundle |
| Only three admin links, other sections missing | Initial port exposed only working native features and blocked MySQL actions | Role-aware menu now explains pending routes. Menu restoration is not implementation of payments/orders/users/etc. Guards protect actions even when posted to another route |
| Settings save failed on D1 | Original MySQL transaction action incompatible; a relative import also escaped the first native alias | Native atomic UPSERT preserves independent JSON sections. Explicit bundler alias plus compiled-bundle assertion; source unit tests alone did not prove runtime resolution |
| Import/upload payload and partial-failure risks | Review rejected raising a global protected-route body ceiling; acknowledgements can be uncertain after committed writes | Current browser-optimized800KiB payload fits retained1MiB guard. Atomic five-product batches and readback/idempotency; retain gallery objects after uncertain DB acknowledgement, flag possible orphans |
| Domain on Cloudflare but site still on Hostinger | Nameservers/proxy are not Worker hosting | Actual Worker Custom Domains attached for apex/www; imagenes stays R2. Canonical/robots/admin origins verified separately |
| “$5 used 0.1%” confused with shopper capacity | Build minutes, CPU share, request count and wall latency are different measurements | Model the correct meter and shared period. No representative shopper/session benchmark or matched Hostinger baseline exists |

The HTTP checks do not prove 429 will never recur. An earlier Python urllib probe received403 followed by Node fetch200; the client-dependent difference was not isolated. Preserve this uncertainty instead of declaring all rate/security behavior solved.

## Current native import and image procedures

Read C:/Projects/productos-workers-staging/docs/WORKERS-CATALOG-IMPORT-2026-10-10.md before importing. CSV/Excel up to800KiB and500 products; preview then confirm five products per atomic batch. Validate SKU conflicts and counts. Existing stock is preserved unless explicitly overwritten, and omitted mode/visibility/private-link values and existing supplier alternatives/photos are retained. Repeat imports are idempotent by SKU/slug.

Existing R2 references such as r2:p1/...@WIDTHxHEIGHT are validated for delivery variants/fallback before saving. External Dropi image URLs are not automatically scraped by this importer. Local browser conversion makes bounded WebP/JPEG variants with longest edge1200 and combined800KiB payload. Those limits belong to this implementation, not a universal Cloudflare limit.

Clean only newly uploaded objects when it is known the DB did not commit. If a database acknowledgement is uncertain, retain objects and reconcile references before cleanup/retry. Authenticated deployed create/import/photo acceptance remains required. Do not reupload the821 existing photos merely to test migration.

## Metrics: facts and assumptions

Measured adaptive usage at 13:53:47 UTC on10October: Productos1774 invocations,80999.668 CPU milliseconds, arithmetic mean45.659 ms, median11.084 ms, p99414.814 ms and zero recorded errors in that window. Entire account CPU consumption was0.27016% of included monthly CPU. This includes mixed versions/test/admin/bot traffic, not a representative customer workload.

An illustrative allowance calculation at45.659ms/invocation gives about657000 invocations from30million CPUms. Assuming five pages/session and two Worker invocations/page gives about65700 sessions;50000 was a provisional headroom scenario. These are estimates before other projects and other meters, not measured site capacity. The median11ms dashboard value cannot replace the arithmetic mean in that calculation.

Earlier 166–259ms CPU examples and large wall durations were small historical samples; no controlled before/after study established a Hostinger-to-Workers speed improvement. Paraguay traffic can use regional Cloudflare infrastructure, but distance to the database, execution placement and cache behavior still need measurement. No CPU/wall/visitor claim should be inferred from the price alone.

## Rollback and retirement

Live domain attachment was accepted10October05:28UTC. www redirects to HTTPS apex preserving path/query; preview stays noindex. Public sitemap uses the live origin and262 product entries. At cutover public HTML bypassed shared cache due to framework private/no-store; no new anonymous HTML cache hit savings are claimed.

Hostinger rollback targets were retained as rollback-hostinger.productos.com.py and rollback-hostinger-www.productos.com.py. To revert, detach ONLY the apex/www Worker Custom Domains and restore DNS-only origin CNAMEs to productos.com.py.cdn.hstgr.net and www.productos.com.py.cdn.hstgr.net. Reconcile D1 edits first. Leave nameservers, R2 image domain, email records, session secret and D1 data alone. A rollback origin is not a synchronized replica or independent backup.

The old Hostinger app has not been deleted by this documentation task. Retire only after required feature acceptance, jobs/integrations/aliases checks and deliberate data recovery planning. Full checkout is not ready.

## Local source files for investigation

All paths below were located/read for this work; use the path map if the owner later relocates them.

- C:/operation manuals/productos.new/README.md — stable owner procedures and dated status.
- C:/operation manuals/PROJECTS.json and STORAGE-MAP.json — authoritative local locations; storage/AI-STORAGE-HANDOFF.md for policy.
- C:/Projects/productos-workers-staging/docs/operations/workers-git-build-repair-2026-10-10.md — automatic build failure/config scope.
- C:/Projects/productos-workers-staging/docs/operations/workers-login-reset-2026-10-09.md — D1 login/dashboard/reset reproduction.
- C:/Projects/productos-workers-staging/docs/operations/workers-admin-recovery-2026-10-09.md — admin guards/recovery and gallery follow-up.
- C:/Projects/productos-workers-staging/docs/operations/workers-d1-settings-repair-2026-10-10.md — atomic settings fix/runtime alias.
- C:/Projects/productos-workers-staging/docs/operations/workers-domain-cutover-2026-10-10.md — routing acceptance and rollback.
- C:/Projects/productos-workers-staging/docs/WORKERS-CATALOG-IMPORT-2026-10-10.md — native imports/image constraints and failure handling.
- C:/Projects/productos-workers-staging/docs/operations/workers-overnight-review-2026-10-10.md — platform differences/remaining gaps.
- E:/ai work/Artifacts/productos.new/2026-10-10/domain-cutover/STATUS.md — cutover evidence; older current-status paragraphs may be superseded.
- E:/ai work/Artifacts/productos.new/2026-10-10/d1-settings-repair/REPORT.md — settings acceptance.
- E:/ai work/Artifacts/productos.new/2026-10-10/usage-and-catalog/REPORT.md and USAGE.json — latest source/usage evidence.

Implementation starting points: vite.config.ts, package.json, wrangler.jsonc, workers/d1/policy.mjs and workers/d1/preview-entry.mjs in the checkout. Inspect actual current filenames/config before modifying; source may advance after this dated ledger. Provider claims are sourced in GUIDE.md and must be refreshed for future migrations.
