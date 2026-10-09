# Productos Cloudflare staging setup


## Current follow-up — 2026-10-09

Request-scoped mysql2/Drizzle public reads and stream cleanup are now implemented. A real local workerd preview renders a disposable SELECT-only catalog (262 products / 9 categories / 821 R2 image references) at http://127.0.0.1:8790. The remote Hyperdrive binding/origin verification is still absent; the code fails closed when it is missing. Earlier paragraphs below are historical build evidence, not the current coding status. See [database pilot, measured local checks and remaining provider steps](workers-hyperdrive-pilot-2026-10-09.md). This is still a public-read pilot, not a completed admin/checkout port.

Checked 2026-10-09. Repository: `antonmarklundcom/productos.new`. Branch: `codex/workers-staging-20261009`. Local checkout: `C:/Projects/productos-workers-staging`. This branch is a public-preview foundation, not a finished production port.

## What exists and what still needs coding

The original Next.js commands remain. Separate vinext/Vite commands produce a Worker package and static assets. The preview wrapper permits anonymous GET/HEAD requests to public pages and health, strips credentials/cookies, blocks private routes and all mutations, and prevents indexing. Three route-policy tests and five local runtime probes passed. No live domain, catalog, images or database was changed.

The database code still uses the Hostinger module-global mysql2 pool. Before a catalog preview is deployed, Codex must implement request-scoped Workers connections, wire a dedicated Hyperdrive binding and verify TLS, SQL compatibility, dates and streaming cleanup. Provision an isolated catalog database or credentials restricted to SELECT for the initial public preview. An HTTP route guard is not a database permission boundary. Do not give this scaffold production write credentials. Later authenticated staging needs a separate database with synthetic customer/order fixtures.

Admin, checkout, transactions, distributed security limits, backups and bulk import remain outside this preview. They need a separately verified full-port phase before the preview guard can be removed. Native sharp processing is disabled in the Worker; local image preparation remains available. Existing R2 gallery images are reused.

## GitHub and Cloudflare build connection

Use the existing repository. Keep Hostinger deploying its existing branch. Do not change the apex/www CNAMEs, connect a production domain to this Worker, merge this draft or enable production deployments from this branch yet.

Once the database adaptation and isolated binding are ready, connect the GitHub repository to a distinct Cloudflare **Worker**, not a Pages static deployment. Authorize repository access only to `productos.new`. The existing Cloudflare CLI session can also deploy; no separate repository or repeated Hostinger login is necessary for Worker code operations.

| Worker Builds setting | Value |
|---|---|
| Worker name | `productos-workers-staging` |
| Repository | `antonmarklundcom/productos.new` |
| Deployment branch | `codex/workers-staging-20261009` — verify it did not default to main |
| Root directory | Repository root |
| Package manager | `pnpm@11.24.0` from package.json |
| Node | 22 or 24, matching the pinned dependencies and engines |
| Build command | `pnpm build:vinext` |
| Deploy command | `pnpm deploy:vinext` |
| Initial hostname | The assigned `productos-workers-staging.<account-subdomain>.workers.dev` |

Cloudflare documents Git connection under **Workers & Pages → select Worker → Settings → Builds → Connect**. Creation screens may offer Git connection directly. Connecting a branch can trigger an immediate build/deployment; wait until its isolated database configuration is ready. Do not copy Hostinger's `next build`/`next start` deployment settings into this Worker.

Set these non-secret build variables before the representative catalog build:

**NEXT_PUBLIC_IMAGENES_URL**
```
https://imagenes.productos.com.py
```

**NEXT_PUBLIC_SITE_URL**

Use the actual assigned staging HTTPS origin, without guessing the account subdomain. Public variables are compiled into client code; changes require rebuilding. Runtime variables/secrets are configured separately from Build variables. This scaffold intentionally includes no database secrets, production session/setup/cron secrets, R2 upload keys, Worker routes or production bindings.

Do not enable email, payment webhooks or cron on this initial preview. Reading existing public R2 images does not require R2 upload credentials or an application R2 binding. No images need uploading again.

## Local checks and benchmark

Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:workers-preview`, `pnpm build:vinext` and `pnpm exec wrangler deploy --dry-run --config dist/server/wrangler.json`. A dry run packages code but does not deploy it. Generated output is ignored by Git.

After database adaptation, the first real preview must show the expected catalog without changing its source. Verify image selection/CSP on a 390px phone, category navigation, publication/price parity, no private supplier information in public responses, no cookies, blocked writes and no indexing. Stop on rate limits, server errors, wrong data or unexpected writes.

The bounded HTTP smoke script is `scripts/workers-benchmark.mjs`. It allows only the named staging workers.dev origin, 1–100 sequential GETs and at least one second between requests, stopping on any non-200. Its `--self-test` checks cost arithmetic without network requests. HTTP latency is not billable CPU. Use Cloudflare CPU metrics/logs and total or traffic-weighted mean CPU for cost; record cold/warm runs and include navigation/RSC/prefetch requests. Extend the workload only after the small pilot passes. No deployed CPU measurements exist yet.

The wrapper sets HTML `Cache-Control: no-store` for the initial anonymous baseline. Do not call that an optimized public CDN-cache result. Framework cache behavior still requires measurement. Compare controlled public caching and selective prefetch changes later, preserving price/publication invalidation and private-response protections.

## Budget and rollback

Your supplied subscription shows Workers Paid Active. Domain Free plans are separate and can stay Free. The compute allowance is shared by every Worker in the account: $5/month includes 10 million requests and 30 million CPU ms; excess is $0.30/million requests and $0.02/million CPU ms. This is a target budget, not a guaranteed flat bill or hard spending cap.

The staging config caps each invocation at 1,000 ms CPU. This limits unusually expensive requests but cannot cap total monthly charges; verify that valid requests do not exceed it. Observability is fully sampled for this low-volume pilot, then sampling/retention should be reviewed against account log usage. Avoid repeated unnecessary builds: Paid Workers Builds includes 6,000 build minutes/month, then $0.005/minute. Database hosting and other services are separate costs.

R2 Standard includes 10 GB-month storage, 1 million Class A and 10 million Class B operations/month, with free egress. The existing prepared gallery set is 125,256,916 bytes (about 0.125 GB), but other account usage is unknown. R2 Paid enables metered overages; it does not imply another mandatory $5 image subscription. Cloudflare Images transformations are unnecessary for these pre-sized files.

Set usage notifications and review account totals. Notifications do not stop charges. Retain Hostinger as the unchanged origin until a full port passes its separate data/security tests. A broken preview can be disabled or rolled back without touching the live website. After a future cutover, code rollback alone cannot reverse database writes; use a reviewed data recovery plan.

## Official references

- [Worker Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)
- [Next.js/vinext guide — beta](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Build pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Hyperdrive SQL support](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/)

