# Productos public rendering and account cost — 10 October 2026

## Scope and deployment

Checkout: `C:/Projects/productos-workers-staging`, branch `codex/workers-staging-20261009`, PR14. This is the native D1/R2 Workers build serving productos.com.py, distinct from Hostinger main. Before this change, live version was `3dccef39-a0c7-425c-891a-5cad5710253a`, source `751dbbee`. No database migrations, production records, images, paid products or DNS settings change in this increment.

## Implemented behavior

- Anonymous GET HTML for home, category and product routes uses a 60-second Cloudflare Cache API entry scoped to the deployed Worker version. Admin, cookie/authenticated, RSC/framework variants, queries, conditional requests, actions, ranges and no-cache requests bypass. Non-200, private/no-store, cookie-setting, nonce-bearing and unexpected Vary responses cannot enter the cache.
- The wrapper strips the internal rendering TTL header from incoming requests, then supplies it only for eligible renders. Workers middleware opts those reviewed renders into public caching and nonce-free CSP. Cookie-bearing product/admin renders retain nonce policies. Normal Next/Hostinger middleware is unchanged. Framework background ISR remains disabled because its D1 client is request-scoped.
- The current Vinext framework Vary fields are allowed only when all corresponding variant headers are absent on the request. Tests protect the boundary; a newly introduced Vary field fails closed until reviewed.
- Cache entries are per Cloudflare data centre and per deployment. A new version starts cold. Displayed stock/price can be up to 60 seconds old after an edit; this is a WhatsApp enquiry catalogue, not transactional checkout. revalidatePath does not purge this separate global cache. To disable: set WORKERS_PUBLIC_CACHE_SECONDS to 0 in wrangler.jsonc and rebuild/deploy. Do not cache checkout when implementing it later.
- The homepage latest-category section replaces six separately hydrated category queries with one bound SQLite selection and one shared getCatalog hydration. Category order and four visible picks are preserved. Unpublished/inactive products/categories and products without active variants are excluded. Existing price/stock/domain calculations still hydrate the results.
- Contacto and the rendered 404 hide unavailable order tracking in catalogue mode. The catalogue Pagopar return redirects home before querying unported order tables; its Worker route remains blocked. Public Link prefetch is disabled in Workers: a desktop home visit had fetched four uncached categories before any click. Explicit Link settings and normal Next behavior are preserved. Typing in search avoids an unported suggestion action; submitting GET search remains supported. Full-store behavior stays available in the normal build.

## Validation and release

Run from the existing checkout, without a new install: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:workers-preview`, `pnpm build:vinext`. MySQL integration requires a disposable test database via TEST_DATABASE_URL; never substitute production. Worker tests use disposable local D1. Small test fixtures may use the existing `C:/dev/productos-small-test-scratch-20261010`; external build/report temp and caches stay on E:.

Two candidate versions were uploaded without changing live traffic. Final candidate `42a20103-1dc4-4523-9477-6715381f5d0f` passed cache MISS/HIT and mobile/desktop interactive checks. Preview URLs stay noindex. Repeated candidate header times were 90–590 ms versus cold 1.5–2.8 s; network times are not CPU measurements.

Push this watched branch to trigger the existing Cloudflare automatic build. Verify GitHub checks, then `pnpm exec wrangler deployments list --config wrangler.jsonc` and version metadata against the pushed commit. Verify live HTML cache HIT, private bypass, health counts and browser interaction independently; uploading a candidate is not a production deployment.

Rollback application-only with `pnpm exec wrangler rollback 3dccef39-a0c7-425c-891a-5cad5710253a --config wrangler.jsonc`, then verify health and public pages. It restores the old rendering implementation, not data or DNS. Version-separated caches prevent old and new HTML mixing.

## Measuring cost without marketing analytics

Cloudflare Web Analytics is free and uses a small browser script; it is optional for real visitor page-speed data. It is separate from the existing Worker operational dashboard. No GA4 is installed. The existing Cloudflare automatic Web Analytics site is enabled (excluding EU traffic). Its injected beacon was blocked by CSP; Workers-only middleware now permits the exact Cloudflare script/beacon origins on public pages. Cloudflare supplies the nonce on dynamic HTML. Admin CSP remains unchanged. No duplicate manual snippet or provider build setting was added.

Measure account-level monthly Worker requests and SUM CPU milliseconds (use arithmetic mean for forecasts, not p50), public HTML cache hits/misses, D1 rows read/written/storage, R2 operations/storage and build/log usage. Measure mobile page experience from Paraguay. A PC trace was loc=PY/colo=GRU: routing through Sao Paulo is an observed Cloudflare edge, not proof of Hostinger hosting or all visitors' routing.

Paid Workers minimum is $5/account/month, with 10 million requests and 30 million CPU ms included across its Workers. Beyond those, $0.30/million requests and $0.02/million CPU ms. Static Assets served directly without invoking a Worker are free/unlimited. This application's Cache API hits still invoke the lightweight wrapper, so still count requests and small CPU; they avoid catalogue rendering and D1 reads. Do not confuse this with Cloudflare's separate Workers Caching configuration, which can skip invocation but still charges cache requests.

Worker-only estimate: 5 + max(0, requests-10,000,000)/1,000,000*0.30 + max(0, cpuMs-30,000,000)/1,000,000*0.02. Add separate D1/R2/build/log/other charges. Example assumptions only: 100 sites x 1,000 dynamic requests/day x 30 days = 3 million requests/month; at 50ms average CPU -> $7.40 Worker-only, at 5ms -> $5. This is not a forecast from the small diagnostic sample or a guaranteed whole-account bill.

For future sites prefer static HTML and direct static assets for public content, cached dynamic catalogues where edits need quick visibility, and protected dynamic admin/actions. Avoid extra dynamic requests on typing, duplicate homepage hydration, per-visit third-party calls, excessive image sizes and unnecessary rebuilds. Account limits and traffic vary; do not promise hundreds of sites for a fixed bill without the aggregate usage calculation.

Read-only bounded before/after command: `node scripts/benchmark-workers-public.mjs --phase after --output "E:/ai work/Artifacts/productos.new/2026-10-10/metrics-fix/after.json"`. Nine sequential public requests; filtered tail records only route/CPU/wall/outcome for this probe. It omits request headers, IPs, private traffic and raw logs. Partial trace samples are diagnostic, not a representative monthly mean. No production mutation or user load test.

Sources checked 10 October 2026: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Web Analytics](https://developers.cloudflare.com/web-analytics/about/). Release results and bounded diagnostic files: `E:/ai work/Artifacts/productos.new/2026-10-10/metrics-fix/`. Owner manual: `C:/operation manuals/productos.new/README.md`.

## Placement and D1 measurement follow-up

D1 info confirmed ENAM; query metadata identified its serving primary as ORD. Nine forced-cold PY/GRU requests to equivalent isolated mode-off and mode-smart previews yielded mean header times1766ms and1796ms; sample p95s2137ms and2609ms. Neither preview supplied cf-placement; live placement stayed unset. These are preview timings, not proof of optimized execution or a valid actual placed/unplaced comparison. Smart Placement may need up to15minutes and consistent traffic from multiple locations; it only learns from locations where the Worker has run. Source wrangler.jsonc is unchanged. Automatic approval review rejected a live placement change under the owner's instruction to leave build settings unchanged. A separately approved temporary live runtime placement test remains necessary for a conclusive result.

Cache API entries live at the execution data centre. Placement can move the lookup away from GRU or start a new cold cache; compare warm hits and database misses together. No production placement or provider branch/build settings changed.

An isolated D1 profiler preserves original raw() responses, then replays only SELECT reads through all() for actual rows_read metadata. Duplicate reads/buffering are excluded from CPU/TTFB probes. The profiler is never deployed to production; no writes or private parameters/data are saved. A controlled before variant used the original six category hydration calls with cache disabled. Cold home queries fell56 to26. The first window selector increased home reads2602 to2733, so a materialized correlated selection replaced it: the selector read129rows (versus708 with an explicit category-index hint), returning identical IDs. Final per-page results are in the dated report. Warm home/category/product hits made0queries/0rows read; cold category/product read1177/450rows.

Focused checks cover404 catalogue/full-store behavior, Pagopar return without an order query, public prefetch, CSP drift and disposable D1 selection. Before the follow-up the full suite passed1108 cases,846MySQL skipped; final hook/CI results are in the owner report. The baseline override was restored before the final build. No profiler or overridden build is shipped.

[Placement docs](https://developers.cloudflare.com/workers/configuration/placement/), [Web Analytics CSP](https://developers.cloudflare.com/web-analytics/faq/), [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) checked10October2026. Moving production to main/Hostinger-legacy is a separate owner-reviewed task. Do not merge PR14 or change build branches from this review.
