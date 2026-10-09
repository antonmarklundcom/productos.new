# Workers assessment for the store — 9 October 2026

Recommendation: investigate a staged move to Workers Paid + Hyperdrive + the existing MySQL database, keeping the current R2 image delivery. Do not switch the live domain until the staging app passes authentication, import, enquiry, stock and checkout tests. This is an assessment; no hosting migration or database work was performed.

## Current application and required changes

The repository uses Next.js 16.3.6, React 19.3, Drizzle/MySQL, mysql2, iron-session and server actions. `next.config.ts` generates a Hostinger standalone artifact with webpack. It cannot simply be uploaded unchanged as a Worker.

- `src/db/index.ts` caches a process-wide connection pool. Hyperdrive needs an appropriate request-scoped connection lifecycle, preserved UTC settings, transactions and locking. Current mysql2 ^3.24.4 exceeds Cloudflare's documented minimum 3.13.0; the Worker also needs `nodejs_compat` and mysql2's `disableEval: true`. [Official mysql2 guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-mysql/mysql-drivers-and-libraries/mysql2/).
- `src/lib/rate-limit.ts` uses process-local state. Distributed Workers need a reviewed consistent security limiter; do not remove login/setup/webhook protections. Check client-IP trust boundaries when changing the origin.
- `src/proxy.ts` coordinates CSP, request nonces and cached pages. Preserve this contract and test cookies, redirects, streamed responses, server actions and deployment version changes.
- Review ExcelJS admin imports/exports, request-size limits, cron execution, filesystem-dependent backup tooling and error reporting. Keep local image preparation outside Workers. Existing optimized WebP/JPEG R2 URLs can remain unchanged; an extra cloud image transformation subscription is unnecessary for this catalog.
- Keep MySQL first. D1 is SQLite, so it is not a drop-in replacement for the current SQL schema and stock/order transactions. Whether Hostinger's MySQL is securely reachable from Hyperdrive, including TLS and access rules, remains unverified. Moving the application does not eliminate the Hostinger bill while its other sites or database remain there.

Cloudflare's current Next.js guide uses **vinext**, a Vite-based implementation of the Next API surface. It is beta; the docs require checking compatibility before adopting it for production. App Router, RSC, server actions, ISR and `proxy.ts` are listed as supported, but that is not proof this application is compatible. OpenNext remains an alternative; its current guide flags unsupported Node.js middleware. Evaluate both against this app before choosing. [Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/), [OpenNext guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/).

## Costs and assumptions

Workers Paid starts at $5 per account/month, including 10 million requests and 30 million CPU milliseconds. Additional requests cost $0.30/million and CPU $0.02/million milliseconds. Static asset delivery normally has free unlimited requests; Workers Cache hits are billable requests when that feature is used. These are requests, not visitors. Free Workers' 10 ms CPU limit makes it a poor default for this full ecommerce application. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Illustrative monthly totals for one otherwise unused Paid account, not measured store forecasts:

| Dynamic Worker requests | Assumed average CPU/request | CPU total | Estimated base + request/CPU cost |
|---:|---:|---:|---:|
| 1 million | 10 ms | 10 million ms | $5.00 |
| 1 million | 50 ms | 50 million ms | $5.40 |
| 5 million | 20 ms | 100 million ms | $6.40 |

The owner's earlier account screenshot shows Workers Paid active. If it is still active on the same account, unused allowances are shared with this app; incremental cost could be zero within those allowances. Current billing and other projects' usage were not inspected. Database hosting and optional KV/Durable Objects/logging or other services are separate considerations.

Hyperdrive is included with Workers Paid, with unlimited queries at that tier; the original database still has its own hosting cost. [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/).

R2 Standard's free monthly allowance is 10 GB-month storage, 1 million Class A and 10 million Class B operations, with no egress charge. Overage rates are $0.015/GB-month, $4.50/million A and $0.36/million B. The existing catalog's 125.3 MB of delivery files uses about 1.25% of 10 GB, before other account storage. Operation usage must also be monitored. [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

## Proposed staging and rollback

1. Create an isolated migration branch and preview hostname. Use a disposable test database; do not replay production migrations or import the catalog again into production.
2. Run framework compatibility checks, adapt bindings and DB lifecycle, then validate all existing tests and real Workers runtime behavior. Verify enquiries, public prices, all categories, contact pages, private supplier URLs, sessions, admin import/export, stock locking, order transitions and cached versus private responses.
3. Measure cold/warm page latency, image bytes, MySQL round-trip times and CPU usage from Paraguay. Use results to estimate cost and assess database placement.
4. Cut over only after proof, retaining the Hostinger deployment for rollback. Preserve product slugs, SEO canonicals, sitemap and R2 URLs. A Worker merely proxying the current Hostinger CDN endpoint can retain the current CDN problem.

## Current public errors

Fresh requests returned **429**, with Cloudflare and Hostinger CDN headers, on the homepage, `/contacto` and `/categoria/autos-y-motos`. The owner's reported **428** was not reproduced. The repository has no 428 response implementation on these routes. The supplied DNS points proxied Cloudflare records at Hostinger CDN CNAMEs.

Hostinger documents rate limiting for traffic through both CDNs. That is a strong supported explanation for the observed 429, but provider settings could not be inspected because both dashboards are signed out. Use one CDN: the supported long-term Cloudflare setup disables Hostinger CDN and routes to the verified hosting origin. Do not guess that origin. Temporarily making apex/www DNS-only removes the Cloudflare proxy hop but is not verification of all Hostinger requirements. Keep the R2 custom-domain configuration separate. [Hostinger CDN guidance](https://www.hostinger.com/support/hostinger-cdn-vs-cloudflare/).

Source revision reviewed: main `925ee49`; menu branch changes are separate UI work. No new migrations, DNS changes, security bypasses or orders were performed during this assessment.
