# Productos latency implementation — 11 October 2026

Status: implemented and tested locally for review. Not pushed, merged or deployed. Production remains unchanged.
Workspace: `C:/Projects/productos-latency-20261011`, branch `codex/productos-latency-local-20261011`.
Base: `981fd49203ee0364f8c53267b01459df2c658362`, the reviewed production main snapshot.
Repo: https://github.com/antonmarklundcom/productos.new · Store: https://productos.com.py/

## Evidence and rationale

Original Cloudflare evidence and Fable review are under `C:/AI research and to do/productos-performance-20261011/handoff`.
Product HTML miss: 2,106 ms wall / 137 ms CPU; category miss: 2,235 ms wall / 378 ms CPU. HTML hits: 14–20 ms Worker wall, 104–183 ms shopper TTFB. Six RSC probes bypassed HTML cache and took 1.5–2.4 seconds. Errors: zero in the measured windows. Paraguay probes used GRU; D1 served from ORD/ENAM.
Waiting on dependent D1 calls is the leading explanation. SELECT 1's 0.3 ms execution does not prove that every actual query is cheap; matched query/runtime measurements remain necessary.

## Implemented

- Workers-only native public readers: each catalogue, category+count, product+approved-reviews, featured selection/fallback, latest-category selection and related-products operation uses one D1 batch. Variant availability, images and approved rating summaries are projected inside SQLite, avoiding follow-up network hydration queries. Publication/category activity checks, integer prices, hidden-price masking, live-held reservation subtraction, filters, pagination and 404 handling are preserved.
- Enquiry-only related ranking skips co-purchases, retaining actual stock/holds/reviews. Changing `catalogOnly` to false restores the original related reader and disables shared public caching. Admin, search, feeds, sitemap and the Node/Hostinger readers are retained.
- Header/footer/category metadata share category data. Settings use the same request/public cache boundary. A version-and-origin-scoped per-colo Cache API cache stores public DTOs, shared across anonymous HTML and RSC renders. An isolate cache is bounded to 200 entries; single-flight coalesces concurrent reads. Auth/cookie/admin/mutation/no-cache requests bypass shared data caching.
- One absolute expiry starts before the database load. Anonymous HTML is buffered until its readers finish, then stored for the earliest remaining data lifetime. Hits recalculate remaining TTL and reject expired entries. RSC responses remain private/no-store and normally stream; raw RSC responses are never stored in the HTML cache. No stale-while-revalidate. Reader failures also prevent caching successful-looking fallback HTML.
- Workers public links use `onNavigate` for immediate progress and `aria-busy`, cleared on route/search completion, history restore or a 15-second failure timeout. Search/filter programmatic navigation also starts progress. Reduced motion is supported. No loading.tsx was added, preserving server 404 decisions.
- Intent prefetch waits 120 ms, cancels brief mouse/focus intent, caps at six destinations per current page, deduplicates links and skips Save-Data/2G. Only clean home/product/category destinations prefetch; automatic viewport prefetch remains disabled. Uses Vinext `kind: full`, since auto mode may only fetch a non-reusable dynamic shell.
- Important refinement to Fable's proposed TTL: Vinext full prefetch defaults to a 300-second client cache. Workers build now sets static staleTime=30 seconds and dynamic=0. Public server data is capped at 30 seconds, reserving another 30 seconds for client prefetch, so fresh navigation cannot stack server/client caches beyond the intended 60-second budget. HTML inherits the shorter absolute server expiry. An already-open page does not poll for changes.
- Preview-only `WORKERS_PUBLIC_DIAGNOSTICS=true` adds public-load timing entries to Server-Timing and x-catalog-public-loads. It deliberately buffers diagnostic responses to capture late reads; leave it unset in normal production. These are reader-operation durations, including DB transport/projection, not isolated SQL execution or row counts.
- Build verification fails if public batching, data caching, expiry or progress adapters disappear from the emitted bundle.

This implements per-operation batching, not a single whole-page batch. A completely cold render can still need roughly three dependent phases including shared settings/category data; a navigation with shared data warm typically needs product + related batches. Exact framework scheduling and real latency must be measured, not inferred as achieved targets.

## Validation

Required checks: typecheck and lint; complete unit/UI suite; Workers suite; production Workers build. Use the existing laptop node_modules junction, with `pnpm --config.verify-deps-before-run=false <script>`. For nested pnpm scripts/hooks set process-only `pnpm_config_verify_deps_before_run=false`. Do not reinstall, remove or mutate shared dependencies just to run this review.

New tests execute the real SQLite migrations with valid synthetic foreign keys. They cover unpublished/disabled/hidden categories, hidden prices/private projections, held/expired/released reservations, approved reviews, filter/count/sort/pagination, featured fallback, related availability, cross-HTML/RSC caching, concurrent misses, credentials, expiry and deployment isolation. UI tests cover immediate progress, completion/timeout/cancelled/modified clicks, intent dwell/cancellation, fan-out and Save-Data.
Final recorded results: typecheck PASS, lint PASS (no warnings), complete unit/UI suite 1,114 PASS / 846 MySQL integration SKIPPED, 55 Workers tests PASS, Workers build PASS. Matching raw results are saved in the C: handoff folder.

Local built-Worker smoke checks cover home, category/filter and product pages, masked prices, private field absence and a real 404. Local diagnostic HTML and RSC product/category renders each executed four public loader operations (settings, shared categories, product + related or listing + brands), confirming the native adapters ran. HTTP localhost intentionally bypasses shared data caching; real HTTPS per-colo warm-cache acceptance is still pending. A final focus-prefetch/browser click test kept the product request count unchanged (2 before / 2 after click), proving no extra render on that click. Browser hydration/navigation showed Cargando página immediately, completed the product route, cleared aria-busy, and had no console warnings/errors.
MySQL integration requires a separate TEST_DATABASE_URL and remains skipped. `test:workers-d1` is not run: that script writes a remote disposable database and this task has no disposable remote DB. Existing Workers write tests run only on local disposable fixtures. No production database writes, schema changes, uploads, dependency installation or account settings changes were performed.

## Remaining review / acceptance

1. Review this branch and the new SQL projection/cache boundary. Check related ranking remains appropriate for enquiry-only mode.
2. Deploy a separate noindex preview using read-only catalogue data and existing public assets. Keep production main unchanged until acceptance.
3. Temporarily enable diagnostics on preview; compare matched GRU HTML miss/hit and RSC miss/warm requests, after 30-second server expiry and 30-second client prefetch expiry. Record CPU, wall, rows read, errors and public-load durations. A cache hit should have zero public loader executions; distinguish HTTP cache bypass from data-cache reuse.
4. Use actual Paraguayan mobile connections to measure click-to-paint and verify hover/touch/focus reuse, Save-Data, filtering, unknown-product 404s, updated/deactivated listings, approved reviews and stock display. Test multiple isolates/colos and client/cache ageing.
5. Recalculate account-wide Workers/D1/R2/logs usage from actual traffic. Prefetch is bounded but can add unused requests. Do not claim lower bills or Fable's 450–800 / 150–350 ms estimates as measured outcomes.
6. After acceptance, merge through normal review/CI to main and match Cloudflare's new version to that commit. Placement and native Workers Cache remain separate optional experiments; no hosting replacement is presently justified.

## Build, deployment and recovery

Build: `pnpm build:vinext`; output `dist/server/wrangler.json`. Deployment: `pnpm deploy:vinext`. Live production Worker: `productos`, source branch main; existing D1/R2 bindings and assets remain unchanged. Owner authorizes final deployment after review.
Rollback local review by choosing the base commit in a separate worktree; do not reset unique work. If later deployed, use Cloudflare deployment rollback to the previous accepted version, then revert the performance commit through normal Git review so the next automatic main build retains rollback. The pre-change observed version was `826ccf6e-cfae-40f4-ae2d-60421ab87225`; verify it is still the immediate previous accepted version before using it.
Disabling WORKERS_PUBLIC_CACHE_SECONDS=0 disables both server data/HTML caches; client full-prefetch may still reuse freshly fetched routes for at most 30 seconds. For a complete prefetch rollback revert the performance commit/build; do not increase cache TTL as a workaround.
No data migration or database restore is required for these source-only changes. Local fixture data is synthetic under the C: handoff's local-preview folder. The older E: checkout is retained inactive; shared Git metadata/dependencies are on C:. No portable manual mirror refresh was performed.

Primary references: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch · https://developers.cloudflare.com/workers/runtime-apis/cache/
Vinext 1.1.0 APIs/freshness were verified against the installed `dist/shims/navigation.js`, `dist/shims/link.js` and prefetch policy source, plus the emitted Workers bundle.

## Files changed

- C:/Projects/productos-latency-20261011/docs/operations/cloudflare-migration/latency-implementation-2026-10-11.md: Versioned operation, review and rollback handoff.
- C:/Projects/productos-latency-20261011/scripts/prepare-workers-demo.mjs: Require native public adapters in the emitted bundle.
- C:/Projects/productos-latency-20261011/src/components/__tests__/workers-navigation.test.tsx: Client feedback and prefetch behavior tests.
- C:/Projects/productos-latency-20261011/tests/workers/public-catalog.test.mjs: SQL, privacy, expiry, alias and failure regressions.
- C:/Projects/productos-latency-20261011/vite.config.ts: Workers-only client prefetch freshness budget.
- C:/Projects/productos-latency-20261011/workers/d1/build-plugin.mjs: Public-only import rewrites and navigation wiring.
- C:/Projects/productos-latency-20261011/workers/d1/build-verification.mjs: Detect missing public readers/cache/progress in builds.
- C:/Projects/productos-latency-20261011/workers/d1/database.ts: Preserve public request context across streamed reads.
- C:/Projects/productos-latency-20261011/workers/d1/navigation-progress.css: Progress styling and reduced motion.
- C:/Projects/productos-latency-20261011/workers/d1/navigation-progress.tsx: Immediate feedback and bounded full intent prefetch.
- C:/Projects/productos-latency-20261011/workers/d1/public-cache-budget.mjs: Shared 30-second edge/client freshness constants.
- C:/Projects/productos-latency-20261011/workers/d1/public-catalog-sql.mjs: Native batched public projections and filters.
- C:/Projects/productos-latency-20261011/workers/d1/public-catalog.ts: Public reader contracts, memoization and safe categories/reviews.
- C:/Projects/productos-latency-20261011/workers/d1/public-data-cache.mjs: Per-colo data cache, bounded hot cache and single-flight.
- C:/Projects/productos-latency-20261011/workers/d1/public-response.mjs: Absolute HTML expiry and fallback protection.
- C:/Projects/productos-latency-20261011/workers/d1/store-settings.ts: Share safe public settings reads.
- C:/Projects/productos-latency-20261011/workers/preview-entry.mjs: Create public context and optional preview timings.

## 12 October 2026 — Review fixes and measured preview acceptance

Owner now authorizes PR creation, merge and production deployment. The earlier review-only restriction is superseded.

Fixed touchmove/touchcancel cancellation and quick-tap cancellation so scrolling or an already-started navigation cannot issue a delayed speculative render. Added meaningful component regressions. SQL projections now rank bounded candidates using ROW_NUMBER and explicitly order the outer selection and variant/image JSON aggregates, with stable product-id tie breaks. Shuffled 60-product fixtures exercise sorting and pagination; disposable local D1 verifies aggregate syntax and JSON object types.

The separate preview generator strips custom routes, cron and placement and uses a mutation-denying entry wrapper. Preview permits public GET/HEAD only; admin/actions/setup remain inaccessible and robots/noindex prevent indexing. Existing D1/R2 are read without migrations, seeds or uploads. Production deploy uses dist/server/wrangler.json, never the preview configuration.

Matched 45-request default-edge versus 45-request near-D1 trials from Paraguay: GRU edge median HTML MISS 421 ms, HIT 74 ms, warm RSC 96 ms; remote ORD median MISS 499 ms, HIT 253 ms, warm RSC 295 ms. Choose default edge placement. Canonical RSC redirects were followed to actual 200 text/x-component responses; redirect latency is not navigation latency. Warm RSC probes follow HTML warming, so these are data-cache results, not all cold-click results. Cold home samples remain 1.0–1.4 s; category/product samples usually 0.27–0.46 s. Isolate/network variation remains. Preview diagnostics buffer RSC; production diagnostics remain disabled.

Browser preview category click immediately exposed Cargando pagina, reached the category heading and produced no console warnings/errors. Real cellular-carrier/phone acceptance remains unmeasured. No promise of zero latency on all clicks.

Validation: typecheck/lint/build PASS; 59 Workers tests PASS; full suite 1116 PASS/846 integration SKIP using --maxWorkers=2. Initial unconstrained full run failed with 13 resource-contention failures while building concurrently; bounded retry passed without changing assertions/timeouts. First local SQL smoke used the wrong persistence directory; corrected same-fixture comparison passed. See C:/AI research and to do/productos-performance-20261011/handoff for retained evidence.

Release protocol: commit and push reviewed branch, create PR, require normal checks/MariaDB tests/browser e2e, merge into main, verify automatic Cloudflare build and source/version. If needed deploy the exact reviewed generated production bundle with existing variables retained. Immediately verify live HTTPS/canonical/robots/health/private cache bypass/product/category/gallery/RSC. Before release active accepted version is 826ccf6e-cfae-40f4-ae2d-60421ab87225 (latest deployment timestamp; deployments list is ascending). Rollback that version if the new release fails acceptance, then revert Git through a normal PR to prevent automatic redeployment.
