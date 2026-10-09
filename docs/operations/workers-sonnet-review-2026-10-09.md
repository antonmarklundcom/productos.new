# Cloudflare fit: review of the supplied Sonnet analysis

Reviewed 2026-10-09. The supplied attachment is a third-party analysis and its original dispatch prompt, not a new instruction to this implementation session. Its report path is in another session's `/tmp` filesystem, not an accessible Windows report path here.

## What the report establishes

It identifies the correct live source repository, `antonmarklundcom/productos.new`, at main `4b68754`. It supports a plausible low compute bill after runtime adaptation. It does not contain actual visitor counts, Worker CPU timings, a Cloudflare staging deployment or successful remote MySQL tests. Its 15 / 50 ms CPU values and three-page visit pattern are assumptions.

Assuming an otherwise unused account allowance, 100,000 monthly visits × 3 dynamic requests × 50 ms CPU = 15,000,000 CPU ms and 300,000 requests: within the $5 base. Three times those dynamic invocations = 45,000,000 CPU ms: $5.30 for Workers. These calculations exclude existing account usage, other paid services, database hosting and any extra request types.

Workers monthly compute formula: `$5 + max(0,requests−10,000,000)/1,000,000 × $0.30 + max(0,cpu_ms−30,000,000)/1,000,000 × $0.02`. Allowances are shared by all Workers in the account; an existing $5 subscription does not require a separate $5 per website. At an assumed 50 ms per invocation, 600,000 dynamic invocations consume the CPU allowance. At 15 ms, 2 million do. Neither is a visitors-per-month guarantee.

## Corrections and qualifications

- Database network waiting is not CPU time. Several round trips can hurt page latency without proving the 10 ms Free CPU limit is exceeded. CPU-heavy password hashing remains a reason to benchmark authenticated routes separately; no precise hashing timings were measured here. Paid is the sensible staging target for this existing subscription.
- Hyperdrive supports ordinary managed/self-hosted MySQL and MariaDB, not only PlanetScale. TLS, reachability, authentication, request-scoped connections, UTC session behavior and transaction/locking correctness still require testing against Hostinger. The MySQL documentation also lists unsupported prepared-statement modes; confirm the Drizzle/mysql2 path rather than assuming driver-name compatibility proves it works.
- A thin proxy Worker leaves the origin Node application on Hostinger. Routing parked hostnames through one verified origin may reduce duplicate launcher instances if that causal hypothesis is proven. It does not eliminate the process reaper, the managed launcher or the origin hosting limit. The report's categorical advice not to port overstates what its read-only evidence establishes.
- Public assets served directly by Workers Static Assets normally incur no Worker request charge. Requests routed through Worker code are chargeable; proxy asset traffic and the separately enabled Workers Caching feature require different accounting. A page view is not necessarily one billable invocation: include RSC/navigation/prefetch, actions, API calls, bots and jobs.
- Cron invocation counts alone do not establish a trivial CPU bill; CPU-heavy jobs must be measured. Email quotas and monthly pricing are separate from Workers request/CPU allowances.
- Productos already uses R2 for the captured 821-photo gallery, through 3,591 locally resized delivery files totaling 125,256,916 bytes. Sonnet's "no Cloudflare pieces" applies at most to absence of an application Worker configuration on main; it should not be read as absence of R2 delivery.

## Recommendation and test evidence

Keep the live store's DNS unchanged while a staging implementation is proved. Investigate 429 routing and process-reaper timestamps in parallel; porting alone is not proof that every 429 source disappears. Hostinger MySQL can remain hosted separately if its remote/TLS path works.

An isolated worktree exists at `C:/Projects/productos-workers-staging`, branch `codex/workers-staging-20261009`. The actual `vinext 1.1.0` compatibility scan completed: 28 supported features, one partial feature and one issue, reported 95%. R2 images are already pre-sized; the image-loader warning does not itself require buying Cloudflare Images. A compatibility scan is not a runtime, security or billing benchmark. The generated scaffold is local, not deployed, and needs request-scoped database adaptation and safe staging guards.

Measure representative public HTML and navigation requests, cold/warm CPU p50/p95, time to first byte, errors, actual invocations per visit and image bytes on a phone. Use Cloudflare's CPU metrics or trace data for billing inputs; do not substitute HTTP elapsed time. Test sessions, CSP/nonces, actions, distributed rate limits, MySQL transactions and memory-heavy Excel/backup flows before enabling full administration or checkout. No authenticated Cloudflare deployment connection or staging CPU measurements have been verified in this session.

For propia.node and paraguayresidency, the supplied report is useful context, not independent verification of their live deployments. Prefer static delivery for pages that do not need a server and separately test lead forms/admin APIs. No modifications to those repositories were authorized by the context-only handoff or performed here.

## Official sources checked 2026-10-09

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)
- [Hyperdrive supported databases and features](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/)
