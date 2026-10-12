# Hostinger to Cloudflare migration guide

Updated 10 October 2026. Reusable procedures drawn from Productos; project-specific evidence is in PRODUCTOS-FINDINGS-2026-10-10.md. Prices, limits and adapter support must be checked again for each migration. This document records a method, not authorization to migrate another site or purchase services.

## Choose the smallest suitable architecture

| Site needs | Candidate architecture | What remains to verify |
| --- | --- | --- |
| Brochure, guides, mostly static SEO content | Static assets, with a small Worker only for forms if needed | Redirects, languages, canonicals, form delivery and analytics |
| Existing transactional MySQL app with difficult SQL | Workers framework adapter + external database, potentially Hyperdrive | Origin TLS/network access, actual driver/ORM compatibility, pooling, correctness and database cost |
| Small catalog or app whose SQL can be deliberately ported | Workers + native D1 + R2 | SQLite schema, atomic writes, timestamps, authentication and every business operation |
| Heavy native dependencies, long compute or incompatible framework features | Retain a Node origin or evaluate another hosting architecture | Actual blocker, operational cost and maintenance; do not force the full app into Workers |

For a content site, do not create an ecommerce-sized migration checklist. For a store accepting payments, a working home page and admin login are insufficient. Define the intended launch: catalog/enquiries, or full checkout with inventory and orders.

Vinext is currently the recommended Workers Next.js option in the provider guide, but is beta. Check the project's Next.js version and feature compatibility, and compare OpenNext where appropriate. Productos uses Vinext; this is not a requirement for every repository. [Official Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/).

## Platform differences

| Concern | Hostinger managed Node | Workers migration consequence |
| --- | --- | --- |
| Execution | Persistent processes with host resource limits | Request execution in isolates; no ordinary always-running next-server or SSH process supervisor |
| Node APIs | Node runtime and host filesystem | Check compatibility flags, dates, libraries and native modules; Node compatibility does not guarantee every dependency works |
| Files | Host files may survive requests/deploys according to host configuration | Virtual filesystem is not durable app storage; use suitable object/database storage |
| SQL | Existing MariaDB/MySQL engine and migrations | D1 is SQLite; Hyperdrive retains an external database rather than converting it |
| Configuration | Host build/runtime environment | Separate build variables, runtime variables, secret bindings and deployment environment |
| Images | Local disk or external provider | Existing pre-sized R2 files can be reused; resizing need not happen on each request |
| Jobs | Host cron or persistent process | Port each job to an appropriate scheduled/event mechanism and preserve retry/idempotency behavior |
| Authentication | Existing database, cookies and host sessions | Choose account/session migration deliberately; a new D1 copy does not automatically inherit accounts |
| Routing | Origin hostname, aliases and CDN | Worker Custom Domains/routes are distinct from nameservers and orange-cloud DNS |
| Rollback | Revert code/origin | Reverting frontend routing also requires reconciling any writes to the new database |
| Cost | Hosting allocation/process budget | Account-shared request/CPU allowances plus separate data, build, log and email meters |

Workers supports node:fs through a memory-based virtual filesystem with compatible flags/dates. It is incorrect to assume all fs APIs are unsupported, or to assume a writable directory is a durable host disk. [Official filesystem behavior](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/).

## 1. Discover without creating another checkout

Read the local path register, storage map and repository AGENTS.md/CLAUDE.md. Reuse the canonical checkout; create a Git worktree only when isolation is necessary. Respect the owner's external-drive policy and retain protected local programs and databases. Do not clone/install merely to inspect a project.

Record repository, clean/dirty state, source branch/commit, live deploy branch, adapter version, config, build/deploy scripts, Worker version and live URLs. Read existing scripts before executing them. Inspect secret NAMES and binding NAMES; never copy secret values, connection strings or customer records to docs.

Inventory routes AND actions: public pages, admin pages, form endpoints, Server Actions, uploads/imports, checkout, payments, stock, jobs, email, accounts, supplier data and external integrations. Include menu entries, not only URLs discovered by a crawler. For multi-domain sites, inventory host routing, parked domains, language/brand data, cookie scope, redirects, CRM source tagging and unique content.

Create a parity table for this project:

| Capability | Source behavior | Target implementation | Source checks | Deployed acceptance | Remaining/owner action |
| --- | --- | --- | --- | --- | --- |
| Example: catalog edit | Saves private supplier cost and public retail price | Native D1 action | Tests/build pass | Unchanged save/readback passed | New-record scenario pending |

Use statuses such as absent, read-only, implemented, source-tested and deployed-accepted. Do not equate implemented with deployed-accepted. Pending menu entries should explain their availability, not silently break or bypass authorization.

## 2. Establish an isolated preview and deployment pipeline

Use a separate Worker, temporary workers.dev URL and isolated data for initial tests. Reuse existing image URLs with read-only access where safe. Avoid pointing a write-capable preview at live business data without a specific reason and authorized scope.

Keep the migration branch in the same repository by default. Preserve the Hostinger branch/main and its working build configuration until retirement is deliberate. A separate repository is justified only by sustained operational separation, not merely to obtain a preview. Do not merge a draft port into main just to deploy a branch.

In Cloudflare, check Settings > Build > Branch control. Set the actual watched production branch for the dedicated preview Worker; this setting is independent of GitHub's default branch. If the creation flow lacks a selector, create a placeholder Worker, then connect the repository with the reviewed branch/commands. An arbitrary main build is not automatically safe or compatible. [Build branch controls](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).

For Productos ONLY, the commands are pnpm build:vinext and pnpm deploy:vinext, root /. Another site must use its own reviewed scripts. Verify the dependency lockfile and normal hooks; do not suppress checks to make a deploy appear green.

Prove four distinct results: source checks, adapter build, direct deployment if used, and Git-triggered Linux build/deploy. Match the automatic build commit to the active Worker version. A direct deploy can be live while its next automatic build fails. A Hello World preview proves routing to a Worker, not deployment of the app.

When a build fails, record the FIRST substantive error, stage, platform, source revision and command. An aggregate GitHub check label alone is not a diagnosis. Scope adapter fixes so that retained Hostinger behavior still works.

## 3. Port data and business semantics deliberately

Choose D1 or the existing SQL engine based on application behavior, not the desire to use every Cloudflare product. R2 stores objects; it is not the relational product/order database. D1 is included under applicable Workers Paid allowances, but has separate consumption limits and charges.

For D1, audit SQL types, operators, generated IDs, uniqueness, indexes, nulls, JSON, fulltext, unsigned arithmetic, timestamps and migration lineage. Audit transaction callbacks, FOR UPDATE and every read-modify-write operation. Translate integer monetary values without floating-point conversion. Make related writes atomic with a supported design; D1 batch operations have documented atomic failure behavior, but do not replace arbitrary interactive MySQL transactions mechanically. [D1 database/batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/).

Bind timestamps in a supported representation rather than passing raw JavaScript Date objects. Use a consistent UTC representation and explicit business-zone boundaries. Test reservation expiry across timezone/day boundaries. A dashboard query can fail after a correct login because of a date encoder; password length is not a diagnosis of that failure.

For Hyperdrive, MariaDB is supported and TLS requirements matter. As of this review, the MySQL support page lists protocol-level prepared statements as unsupported. Inspect the actual ORM/driver execution path; absence of .prepare() calls is not proof that .execute() avoids prepared statements. Inspect per-session assumptions such as SET time_zone against current pooling behavior and test them. PostgreSQL behavior must not be inferred from MySQL restrictions. [Supported databases and features](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/), [mysql2 example](https://developers.cloudflare.com/hyperdrive/examples/connect-to-mysql/mysql-drivers-and-libraries/mysql2/).

Export/import into isolated target data with an explicit snapshot time. Preserve IDs, source URLs, private costs, retail values, modes, visibility, variants, stock and images. Compare counts plus representative field values/fingerprints; matching product counts alone misses corruption. A healthy SELECT does not prove a write works. Do not repeat completed production schema repairs, seeds or owner creation merely because a new session starts.

D1 and Hostinger do not synchronize automatically. Before cutover, freeze writes or record/reconcile a final delta. Decide which database is authoritative after cutover and how post-cutover edits would be recovered before rollback.

## 4. Preserve authentication, admin and email

Test successful login, wrong credentials, redirects, logout, expired/revoked cookies, roles, private field exposure, same-host Server Actions and recovery. Enforce authorization inside actions as well as routes; posting an action ID to another allowed route must not bypass a pending-feature guard. Keep sessions request-scoped across concurrent requests and streamed responses.

Distinguish existing-password authentication from policy for creating/resetting a password. Do not create another owner to resolve a dashboard exception. Use the project's explicit reset tool, with hidden entry and no password in command history, logs or chat. If preserving accounts, deliberately migrate the supported hashes and decide how sessions are invalidated; do not assume a separate DB already has the old login.

Email Routing is inbound forwarding. Email Sending is outbound delivery. A recovery form accepting an email address does not prove a message was sent. A recovery flow needs a verified sender/domain, runtime binding, bounded token lifetime, safe one-use redemption and actual inbox/reset acceptance. Recheck current product availability, quotas and pricing before enabling it. Keep recovery marked unavailable until delivery is tested; never invent a sender.

## 5. Reuse optimized images safely

Preserve the existing bucket, object keys and image metadata. Resizing/format conversion can happen locally before upload; no paid image transformation service is required solely for migration. Inspect actual dimensions, bytes, responsive srcset, fallback, alt text, OG images and cache headers. Avoid downloading or reuploading an entire gallery to move the frontend.

On Productos, NEXT_PUBLIC_IMAGENES_URL is the exact public image-origin name. NEXT_PUBLIC_IMAGENES_UR was a typo. Its build-time value must reach the client bundle; a runtime-only value does not repair already compiled browser code. Inline only reviewed public variables, never the whole environment. Verify the gallery AFTER hydration at phone width, not just URLs in initial HTML.

For imports/uploads, preview one record, commit, read back price/mode/stock/private URLs/images, then use small batches with IDs/counts recorded. Keep existing stock unless overwrite is explicitly intended. Validate existing R2 references; do not silently turn external image URLs into authenticated scraping. A failed/uncertain response may still follow a committed transaction: read back before retrying. Cleanup must never delete objects referenced by a possibly committed gallery.

## 6. Acceptance before promoting the domain

Test home, every menu destination, category/product/contact, error pages, live prices or hidden-price rules, enquiries, desktop/phone navigation and gallery loading. Check no horizontal overflow, keyboard access and useful empty/error states. Verify private supplier links/costs do not appear in public HTML or public data responses.

For a transactional store, additionally test concurrent last-unit purchases, reservation expiry, inventory conflicts, order state transitions, payment idempotency, callback retries, refunds/cancellation behavior and recovery. Preserve the repository's domain invariants. Never launch checkout by removing unsupported-action guards.

Use bounded checks against the deployed revision, record failures and distinguish configuration bugs from missing features. Reproduce an unknown-column error against the app/schema pair before proposing repair. Refresh forms after redeploy to rule out stale Server Action hashes. Failed import previews should not be blindly confirmed.

## 7. Measure cost and performance without confusing units

Measure realistic shopper sessions separately from admin, bots and CI. Start with bounded synthetic sessions; do not perform uncontrolled load tests. Record source/version, dataset, routes, client region, sample size, cold/warm runs, concurrency and think time. Use matched conditions for before/after claims.

Collect arithmetic mean CPU plus percentiles, Worker invocations/session, wall/TTFB, browser LCP/INP/CLS, errors, D1 query counts/rows read/written, R2 operations/bytes/cache hits and build minutes. CPU is execution work; network/database waiting and wall latency are different. The free per-invocation 10 ms CPU limit, paid per-invocation seconds limit and monthly allowance are not 10 ms billing blocks.

Pricing snapshot checked 10 October 2026, USD, before tax; recheck for each estimate:

| Meter | Included usage | Excess |
| --- | --- | --- |
| Workers Paid, account shared | $5 minimum; 10 million requests and 30 million CPU milliseconds/month | $0.30/million requests; $0.02/million CPU milliseconds |
| D1, paid | 25 billion rows read; 50 million rows written/month; 5 GB storage | $0.001/million rows read; $1/million written; $0.75/GB-month |
| R2 Standard free allowance | 10 GB-month; 1 million Class A and 10 million Class B operations/month | $0.015/GB-month; $4.50/million Class A; $0.36/million Class B; internet egress free |

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing and billable-unit rounding](https://developers.cloudflare.com/r2/pricing/). R2 free allowance does not apply to Infrequent Access. Builds, logs, email and other products have their own meters; verify them separately. Static assets can avoid Worker compute, but cache billing depends on the delivery feature/path. Do not promise every cache hit is a free invocation.

Use remaining ACCOUNT allowance after other projects and background traffic:

    invocations_per_session = pages_per_session * worker_invocations_per_page + other_dynamic_calls
    CPU_per_session_ms = mean_CPU_per_invocation_ms * invocations_per_session
    included_sessions = min(remaining_request_allowance / invocations_per_session,
                            remaining_CPU_allowance_ms / CPU_per_session_ms)
    Worker_request_overage_USD = max(0, monthly_requests - 10_000_000) / 1_000_000 * 0.30
    Worker_CPU_overage_USD = max(0, monthly_CPU_ms - 30_000_000) / 1_000_000 * 0.02

Add D1/R2/build/log/email costs, provider rounding and tax as applicable. Requests/page must be measured or explicitly assumed; visits are not unique people. A $5 subscription is not a hard spending cap. Use current available alerts/limits and explain what each can actually constrain.

Optimize measured hotspots: unnecessary dynamic prefetch, duplicated SQL queries, missing indexes, oversized payloads and safely cacheable public data. Parallel SELECTs may shorten wall latency without reducing query counts or CPU charges. Preserve freshness, security and perceived speed. Never override private/no-store on authenticated, cookie-dependent, action or RSC responses indiscriminately. Verify cache eligibility and invalidation instead of claiming savings from a config change.

## 8. Cut over DNS, URLs and SEO with rollback

Nameservers and proxied DNS do not by themselves put the application on Workers. Attach the intended apex/www as Worker Custom Domains or the reviewed route configuration. Record the old origin targets and TLS/routing before changing them. Leave R2 and unrelated email records alone. [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

If Hostinger CDN remains the origin while Cloudflare also proxies it, investigate the documented double-CDN rate-limit risk. Capture exact URL/time/status, response IDs/headers and process logs. Disabling the Cloudflare proxy for apex/www while retaining their Hostinger targets is one reversible diagnostic step; it does not deploy to Workers. Do not guess an origin IP or attribute every 429/428 to processes. [Hostinger 429 diagnosis](https://www.hostinger.com/support/hostinger-cdn-429-too-many-requests-errors/).

Set the real build/runtime site URL, canonical redirects, sitemap, robots, structured data and contact details. Preview stays noindex; public production pages become indexable; admin/private pages stay protected/no-store/noindex. Test www redirects preserving paths and queries, HTTPS, same-host login/actions, navigation, phone galleries and the Git pipeline after routing.

Record rollback steps AND data reconciliation. Returning the hostname to Hostinger with an old database can discard new edits even if all pages load. Keep the retained origin, deployment revision, configuration names and recovery locations documented; never store secrets in the rollback document.

## 9. Retire the old app only as a separate deliberate action

Before removing Hostinger Node: required capabilities accepted, target authoritative data accounted for, exports/recovery plan verified, aliases/jobs/integrations/email checked, and a defined observation/rollback period completed. A retained origin on the same account is not an independent backup. GitHub does not preserve all ignored private files or databases. This guide does not authorize deleting an app, cancelling hosting or editing other websites.

## Report and handover template

Provide: source/deployed versions; architecture/data authority; parity table; checks actually performed; incident/error/status/time; fixes and evidence; usage period/units/assumptions; live/preview/admin URLs; rollback; remaining work and owner actions. Update the stable operation manual and register, with dated technical references. Store non-secret reports outside OneDrive at the owner's registered artifact path.

Useful example requests:

- “Use $cloudflare-workers-deploy to assess this mostly static residency site, retain its lead delivery, and prepare a preview without changing live DNS.”
- “Use $cloudflare-workers-deploy to compare D1 versus our existing MariaDB for this store, including checkout invariants and a deployed acceptance plan.”
- “Use $cloudflare-workers-deploy to diagnose this failed Git build; compare its source/version/config with the working direct deployment and preserve the Node build.”

Canonical source: C:/Projects/productos-workers-staging/docs/operations/cloudflare-migration/GUIDE.md. The installed Codex reference node-migration-playbook.md is a deliberate same-content copy. Refer to the dated Productos findings for project-specific commands/status; do not apply its IDs or thresholds to another site.

## Public navigation and regional latency

For delayed clicks, RSC/HTML cache differences, database round-trip reduction, bounded intent prefetch and measured placement decisions, use [Regional latency lessons](REGIONAL-LATENCY.md). This reference records the actual Paraguay comparison and freshness/privacy invariants rather than promising a universal region or TTL.
