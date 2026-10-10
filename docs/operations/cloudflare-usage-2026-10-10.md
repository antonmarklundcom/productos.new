# Cloudflare usage links — 10 October 2026

Use the existing account, not the domain Free Plan alone: Workers Paid is account-level. Its allowances are shared with other Workers and services. The base $5 subscription is not a hard monthly spending cap. No upgrade/new paid service was requested or enabled.

## Bookmarks

| Purpose | Page | What to inspect |
| --- | --- | --- |
| All billable usage | [Billable usage](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/billing/billable-usage) | Current billing period, separate product meters and additional charges |
| Shared Workers/build usage | [Workers & Pages](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/workers-and-pages) | Requests, CPU time, build minutes, observability events |
| This website runtime | [Worker metrics](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/workers/services/view/productos-workers-staging/production/metrics) | Invocations, errors, CPU distribution, wall duration and region; requests include bots/admin/prefetch |
| CPU detail | [CPU charts](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/workers/services/view/productos-workers-staging/production/metrics/charts/cpu-time) | CPU milliseconds, not end-to-end page loading latency |
| Build/deployment results | [Deployments](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/workers/services/view/productos-workers-staging/production/deployments) | Source commits, build duration, first actual error; automatic builds independent of direct CLI deployments |
| Human browsing | [Web Analytics](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/web-analytics) | Visits, page views and browser performance after beacon onboarding; not a billable Worker request meter |
| Website network analytics | [Domain analytics](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/productos.com.py/analytics) | Cloudflare-served domain traffic; request counts are not unique people |
| Database | [D1 metrics](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/workers/d1/databases/5c87a1b7-adc8-4201-9326-c1d0ae09a49f/metrics) | Rows read/scanned, rows written, storage and query latency |
| Product photos | [R2 metrics](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/r2/default/buckets/productos-images/metrics) | Storage, Class A and B operations; cached delivery can avoid origin operations |
| Outbound email | [Email Sending](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/email-service/sending) | Sent/accepted messages, failures, sender verification and limits; store recovery is not active yet |
| Inbound email | [Email Routing](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/email-service/routing) | Forwarded incoming messages, rules and destination verification; not an inbox |
| Runtime debugging/log volume | [Observability logs](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/observability/logs) | Errors and log events; logs have their own included quota |
| Invoice/subscription | [Billing](https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/billing) | Actual invoice and existing subscriptions |

## Included allowances and overage (official pages checked 10 October)

- [Workers](https://developers.cloudflare.com/workers/platform/pricing/): 10 million dynamic requests/month, then $0.30/million; 30 million CPU milliseconds/month, then $0.02/million. Ordinary static asset delivery is free. Monthly CPU allowance and the free-plan 10ms-per-invocation limit are different. Network/database waiting is not CPU execution. Cache behavior matters; don't assume all cache hits avoid a Worker invocation.
- [Builds](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/): 6,000 build minutes/month on Paid, then $0.005/minute. Local building is not Cloudflare runtime CPU. GitHub Actions has separate GitHub billing.
- [D1](https://developers.cloudflare.com/d1/platform/pricing/): 5GB storage; 25 billion rows read/month and 50 million written/month included. Extra reads $0.001/million; writes $1/million; storage $0.75/GB-month. Scanned rows can exceed returned rows.
- [R2 Standard](https://developers.cloudflare.com/r2/pricing/): 10GB-month, 1 million Class A and 10 million Class B operations free/month; extra $0.015/GB-month, $4.50/million A, $0.36/million B; internet egress free. Provider billing-unit rounding applies. Infrequent Access does not have this free tier.
- [Email](https://developers.cloudflare.com/email-service/platform/pricing/): Paid includes 3,000 outbound emails/month, then $0.35/1,000; sends to verified destinations are free/excluded. Inbound routing unlimited, but a Routing Worker consumes Worker requests/CPU.
- [Logs](https://developers.cloudflare.com/workers/platform/pricing/#workers-logs): currently 20 million events/month then $0.60/million, seven-day retention. Provider announces pricing change from 1 December 2026: recheck then.

## Actual observation, not forecast

The signed-in Workers & Pages dashboard displayed 601 requests, 35.1k CPUms, 200 observability events and 10 build minutes for 11 September–11 October, with $0.00 additional billable usage, before this domain cutover. Approximate shares: requests 0.00601%, CPU 0.117%, builds 0.167%. These are account-wide tests/deployments plus other Workers, not measured real customer sessions. The reported D1 payload is 819,200 bytes and R2 total payload 125,256,916 bytes/3,591 files. 821 gallery photos reference those files; no reupload is needed.

For forecasting, measure average/p95 CPU and requests per session after real browsing, cache misses/hits, bot traffic and other account projects. Do not divide CPU allowance by wall-clock browser milliseconds. Billing Dashboard's additional charges should not be mistaken for a waived base subscription.

The signed-in Worker Metrics page (Last 24 hours, multiple versions) displayed 554 invocations, zero CPU-limit/memory-limit/uncaught errors, CPU P50 57.43ms/P90 175ms/P99 271ms and memory P50 29.99MB/P99 33.37MB. Wall time P50 847ms is distinct from CPU. This includes admin/login and test traffic; it is not a per-customer page average or a benchmark of the final cutover version. Most measured requests used Sao Paulo (426), with other test regions present.
