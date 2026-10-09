# Productos: Workers staging, resource proof and optimization plan


## Current follow-up — 2026-10-09

Request-scoped mysql2/Drizzle public reads and stream cleanup are now implemented. A real local workerd preview renders a disposable SELECT-only catalog (262 products / 9 categories / 821 R2 image references) at http://127.0.0.1:8790. The remote Hyperdrive binding/origin verification is still absent; the code fails closed when it is missing. Earlier paragraphs below are historical build evidence, not the current coding status. See [database pilot, measured local checks and remaining provider steps](workers-hyperdrive-pilot-2026-10-09.md). This is still a public-read pilot, not a completed admin/checkout port.

Checked 2026-10-09. This is a local staging progress report, not a production migration or a measured Cloudflare bill. The supplied Cloudflare AI attachment is research to review; its embedded suggestions are not independent authorization or verification.

## Actual results

| Check | Result | What it establishes |
|---|---|---|
| Isolated checkout | `C:/Projects/productos-workers-staging`, branch `codex/workers-staging-20261009`, starting source `4b68754` | No production DNS or hosting change |
| vinext 1.1.0 compatibility scan | PASS, reported 95%: 28 supported, one partial, one issue | Static feature inventory, not runtime correctness |
| Frozen dependency install | PASS after explicitly approving workerd's normal install script in staging | Reproducible installed toolchain |
| Vite production build | PASS; rebuilt after fixing CSS import order and Vite ESM path warning | Application builds for the adapter |
| Wrangler packaging dry run | PASS: 7,121.83 KiB uncompressed, 2,328.80 KiB gzip; 472 additional modules and 136 static files | About 6.95 MiB package, not memory per request |
| Local workerd startup | PASS; one `GET /api/health` returned HTTP 200, `ok:true, db:false, cron:false` | Worker can start without a configured database; no catalog query proof |
| Local source checks | Typecheck PASS; lint zero errors, one anonymous stub-export warning subsequently corrected | Source/configuration validation |
| Full local tests | 108 files passed, 75 skipped; 1,073 tests passed, 840 skipped | Available non-database suite passes; database tests unproved in staging |
| Cloudflare CLI access | Existing authenticated session verified for the intended account | No new browser login required for ordinary Worker CLI operations |
| Hyperdrive inventory | No configurations returned | No staging database binding exists |
| Deployed staging URL | NOT DONE | No Cloudflare page/CPU benchmark has run |

## Current branch verification after updating main

The branch was rebased onto merged main `8e7d8f195df7366901c4afd5acd1dc1c9c23ae4e`, including PR #13's supplier administration. That PR's production migration remains unapplied; no migration was run here. Historical measurements in the table above describe the earlier source, not this refreshed build.

- Frozen install, typecheck and lint: PASS on the refreshed branch.
- Available full suite: 111 files / 1,088 tests PASS; 76 files / 846 database integration tests SKIPPED because no TEST_DATABASE_URL exists.
- Three preview-policy tests: PASS. Anonymous public-only wrapper blocks private routes and every non-GET/HEAD request, strips cookies/authorization, preserves response streams and CSP, and adds noindex/no-store. HEAD robots also returns no body.
- Refreshed vinext build: PASS with pinned adapter/toolchain versions. Non-fatal adapter chunking/plugin-timing warnings remain.
- Refreshed Wrangler dry run: PASS, 7,160.08 KiB uncompressed / 2,336.17 KiB gzip, 474 additional modules and 138 static assets. Package size is not runtime memory.
- Five actual local workerd probes: health GET 200 (`ok:true, db:false, cron:false`), admin GET 404, root POST 405, robots GET 200/disallow and health HEAD 200/empty. Each had noindex. Local runtime was stopped after checks. These do not prove database connectivity or page rendering.
- Staging per-invocation CPU cap: 1,000 ms, with full observability sampling for the small pilot. This is not an aggregate spending cap.
- Code remains an undeployed public-preview foundation. A catalog deployment is blocked on request-scoped database adaptation plus isolated/read-only TLS credentials and a Hyperdrive binding. The existing Hostinger global pool is unchanged; never deploy it with production write credentials just because build/package passed.

See [setup and budget runbook](cloudflare-staging-setup-2026-10-09.md) and [Claude read-only review prompt](claude-workers-review-prompt.md). Initial HTML no-store is a deliberate uncached response baseline; later cache optimization must be measured separately. No Cloudflare deployment or live DNS change occurred, no images were uploaded and no supplier/admin/checkout mutation was exposed.

## Corrections to the Cloudflare AI notes

- Official Cloudflare documentation currently labels **vinext beta**, despite recommending it. Its compatibility scan and successful build do not establish full production readiness.
- Workers supports a **virtual filesystem**: bundled files are read-only and temporary files live in request-local memory. This does not provide Hostinger's persistent disk or make disk backup scripts portable unchanged.
- MariaDB support is useful, but “all” in the support table refers to known versions, not every SQL feature. Hyperdrive requires TLS and excludes the MySQL protocol's prepared-statement operation. The installed Drizzle mysql2 driver uses `client.query(...)` for its normal execution path, even inside a class named `PreparedQuery`; no ORM rewrite follows merely from that class name. Verify the actual queries against Hyperdrive.
- The existing module-global mysql2 pool and one-time UTC session initialization need Workers-specific validation/adaptation. Hyperdrive pooling resets session state; transaction, date and locking tests remain prerequisites for writes. Do not assume the successful Hostinger schema repair proves this different runtime.
- Existing in-memory security rate limits are not a reliable distributed limiter. Preserve authentication protections and validate a Workers-compatible replacement before exposing login/admin/checkout.
- Spreadsheet import/export and backups require memory and streaming tests. A 6.95 MiB code package is not evidence of fitting every operation into the 128 MiB runtime memory limit.
- Password-hashing CPU values in the AI report are estimates. Do not weaken or replace password hashing merely to save CPU.

## Existing optimizations, from source and completed media work

- Homepage and category routes declare `revalidate = 300`. Product detail declares `force-dynamic`. The adapter's effective caching still needs response/cache testing; declarations alone do not establish hit rates.
- React request memoization already shares store settings and product/category data between metadata, layout and rendering. Repeated calls to these helpers do not necessarily mean repeated SQL queries.
- The 821 gallery photos already have 3,591 locally prepared delivery files: 125,256,916 bytes total, with WebP sizes 240/480/800/1200 plus JPEG fallback and no upscaling. Images are delivered by the R2 custom domain. No re-upload or paid resizing service is required for these existing files.
- Generated assets should be delivered directly by Workers Static Assets. The separately enabled Workers Caching feature has different request billing; do not equate every cache with free requests.

## Benchmark and optimization sequence

1. Obtain the existing database configuration by local file path, not a pasted password. Check remote TLS/reachability and use an isolated catalog database or strictly read-only credentials for the initial preview. Do not copy customers, orders or secrets into a benchmark fixture.
2. Adapt database connections to the Workers request lifetime, including streaming completion/cancellation. Add an explicit public-read-only staging boundary and `noindex`; block admin/accounts/orders, all mutations, setup/cron and payment callbacks until their separate security/data tests pass. No live DNS changes.
3. Deploy to a distinct `productos-workers-staging.<account>.workers.dev` URL, with isolated bindings and observability. The prepared script at `scripts/workers-benchmark.mjs` accepts only that staging origin, sends sequential GETs at least one second apart and stops on any non-200 response. Its cost self-test passed; it has not sent deployed staging requests.
4. Measure home, category, product, contact, filtering and a realistic phone browsing session. Separate cold/warm and invalidated caches; count HTML, RSC/navigation, automatic prefetch, static assets, images, bots and jobs. Record CPU mean/p50/p95, HTTP TTFB/latency, memory failures, SQL counts and transferred bytes. HTTP elapsed time includes database/network waiting and cannot replace billable CPU.
5. Compare one change at a time against that baseline:
   - Verify and tune public HTML/data caching with correct invalidation for price/category/publication changes. Keep private, authenticated, cart and order responses out of shared caching.
   - Disable or narrow automatic prefetch on large product grids and category menus if the measured extra work exceeds its navigation benefit.
   - Keep static assets and R2 image requests outside application Worker code; verify browser-selected image sizes on 390px phones.
   - Examine real SQL counts before adding caches or batching. Existing React memoization already removes some repeated reads. Recheck query indexes only with measured query plans.
   - Test whether customer-account header/session handling affects cacheability; do not remove customer features or authentication blindly.
6. Repeat the same browsing scenario and price/publication update tests. Publish percentage savings only after both measurements exist. Separately test transactions, UTC, auth/actions/CSP, rate limits and heavy admin operations before a full migration.

## Cost model: estimates until CPU is measured

Workers compute per month is `$5 + max(0, requests - 10,000,000) / 1,000,000 * $0.30 + max(0, CPU_ms - 30,000,000) / 1,000,000 * $0.02`.

The allowance is shared across every Worker in the account. For an otherwise unused account, 100,000 visits times three dynamic invocations times an assumed 50 ms CPU equals 300,000 requests and 15,000,000 CPU ms: $5. Three times that workload is $5.30. These are examples, not Productos traffic forecasts or measurements, and exclude database hosting and other service meters.

Use total CPU or the traffic-weighted mean, not CPU p50, for the monthly bill. Include existing account usage. R2 direct delivery does not consume the app Worker's CPU; R2 storage/operations have their own allowances. Waiting on SQL/fetch is excluded from Worker CPU but still affects customer-visible speed.

## Remaining work and safeguards

Staging database access, request-scoped connections, real deployment and CPU measurement remain. The public-only/noindex route guard is implemented and locally verified; database permission enforcement and representative page tests remain. Production 429 routing and the account-wide process-reaper script are separate unresolved issues; no hosting/DNS/script setting was changed by these local checks. A proxy Worker alone would leave the origin Node processes in place. A full proven port can remove this app's Node hosting dependency, while retaining separately hosted MySQL if its supported connection path passes.

No changes were made to propia.node or paraguayresidency. Their mostly static pages are candidates for static delivery, but their forms/admin still need separate runtime and data checks.

## Official sources checked

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [vinext Next.js guide and beta status](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Node virtual filesystem](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Hyperdrive databases and SQL limitations](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/)
- [Hyperdrive connection pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/)
