# Cloudflare public catalog demo — 2026-10-09

## Verified remote result

Open https://productos-workers-staging.marklundfaktura.workers.dev/ without login. Worker version `32c84b2f-2c4c-4e6b-8b0f-a49520be5c0a` replaced the Hello World placeholder. This is a **visual catalog snapshot**, not a completed database/admin/checkout migration. The banner makes that distinction visible. Main, DNS, Hostinger production database and existing R2 objects were not modified.

The snapshot contains 262 products, 9 categories, 26 paginated category pages, 7 home/help pages and a search page: 296 HTML pages total, with 821 existing gallery references. It was captured from the disposable SELECT-only local MariaDB fixture, never from customer/order/user tables. Every product name, displayed price and gallery count was checked against the final public catalog rows. The snapshot retains the original selection, including the known sharpener alternatives; it does not consolidate duplicate product identities. Supplier URLs/costs and credentials are excluded.

Capture timestamp: 2026-10-09 16:46:34 Asunción (19:46:34 UTC). Archive SHA-256: `12728c049d4397846e4cd0b13eee183c75e137f91cd0a31c8fbd5635e7fce4d2`. `workers/catalog-demo/pages.json.gz` stores only public HTML/CSS, not a database backup. No product photos were downloaded or uploaded during this task. Images continue to load from https://imagenes.productos.com.py.

## Implementation and boundaries

`PREVIEW_CATALOG_SNAPSHOT=true` is explicitly configured only in the staging Wrangler configuration. If no `HYPERDRIVE` binding exists, public routes use captured HTML through the ASSETS binding. If a real binding exists, the original request-scoped read-only database pilot runs instead. With neither binding nor the explicit flag, the original missing-database response remains. Private routes still return 404; non-GET/HEAD requests return 405. Direct snapshot artifact URLs are intercepted and denied. Cookies/auth are stripped and pages are noindex/no-store. Snapshot CSP blocks outgoing application connections.

React hydration/server actions are absent from the snapshot. Small same-origin JavaScript supports phone menu, native desktop dropdown, gallery selection/enlargement and text search across all 262 products. Category pagination uses ordinary HTML navigation. Wishlist/cart/account/order tracking and interactive category filters are absent. Search autocomplete is absent. No orders can be submitted. Admin is unavailable with or without login on both preview modes; live administration remains at https://productos.com.py/admin with the existing login.

The normal Vite build is followed by `scripts/prepare-workers-demo.mjs`, which expands the checked archive into ignored `dist/client` assets. Deploy now uses Wrangler against the generated config. The prior `vinext-cloudflare deploy --dry-run` failed reproducibly because it detected ISR with no cache adapter; it also attempted another build. The supplied Cloudflare log stopped before the actual error, so that old remote error text remains unverified. The corrected deployment package and actual CLI deployment succeeded. The original Next.js/Hostinger commands remain unchanged.

The staging-only Vite transform sets page `revalidate` exports to zero. A local home page had become empty after background regeneration despite healthy product/category reads; a request-scoped database client cannot safely serve background ISR after cleanup. This disables that path in the isolated Workers pilot. Persistent public cache configuration and invalidation require a separate verified full-port phase. Do not treat this snapshot as evidence about database transactions, admin authentication, Hyperdrive pooling, or optimized dynamic CPU.

## Build, deploy and refresh

On `codex/workers-staging-20261009`, run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:workers-preview`, `pnpm build:vinext`, then `pnpm deploy:vinext --dry-run`. The build variables remain NEXT_PUBLIC_SITE_URL=https://productos-workers-staging.marklundfaktura.workers.dev and NEXT_PUBLIC_IMAGENES_URL=https://imagenes.productos.com.py. No extra owner environment variable is required for this demo; the snapshot flag is versioned. Keep PR14 unmerged.

Cloudflare Workers Builds keeps build `pnpm build:vinext` and deploy `pnpm deploy:vinext` on this staging branch. Code pushes may replace the staging deployment. Never run a deploy using `dist/server/wrangler.local.json`: it is a private local-only fixture wrapper. To refresh public data deliberately, start the isolated read-only fixture preview on port 8790 and run `pnpm capture:workers-demo --source http://127.0.0.1:8790 --catalog <public-only catalog JSON>`, inspect/audit the changed archive, rebuild and deploy. The capture script refuses other origins and stops on non-200, missing galleries or incomplete catalog. It performs no writes to the store/database/R2.

Rollback only the named staging Worker using its deployment history. Placeholder version was `0dabb369-84e9-4958-a594-1b60dbc1be15`. Do not change apex/www DNS or restore production databases for a demo rollback. Before removing the guard, verify a separate synthetic writable staging database, sessions/rate limits, transaction/stock/date behavior and all private routes. No credentials or commercial services were created to obtain this visual demo.

## Checks and remaining work

- Typecheck/lint and whitespace checks PASS. Full available suite: 112 files / 1,103 tests PASS; 76 files / 846 database integration cases SKIP (no TEST_DATABASE_URL). Eight preview/security/streamed-HTML cases PASS. Default database tests were not run against the public fixture.
- Production Vite build and corrected Wrangler dry run PASS. Package 7,181.81 KiB / 2,345.58 KiB gzip, 438 asset files. Actual staging upload PASS, 35 ms reported Worker startup. Startup is not per-request billable CPU.
- 39 deployed public page/asset probes PASS, including all 26 category pagination routes and the help pages. Eight health/privacy/mutation probes PASS. `/health` truthfully returns db=false, cron=false, previewMode=catalog-snapshot, products=262, images=821.
- Real browser phone (390px) and desktop (1440px) navigation PASS, no horizontal overflow. Phone gallery selection on Barra LED and all four thumbnail loads PASS; local cleaning-brush gallery/search/zoom also PASS. The 821 reference counts do not claim every remote image byte was tested in this run.
- Pending: full database-backed remote app, Hyperdrive origin TLS/firewall/UTC validation, synthetic writable admin/checkout test and measured real dynamic CPU/queries. Full-app $5 fit remains an estimate; this static demo cannot prove it. The initial automatic build failed; subsequent automatic-build status must be tracked separately from successful CLI deployment.

## Sources

- [Cloudflare asset binding](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Next.js on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Existing database pilot](workers-hyperdrive-pilot-2026-10-09.md)
- [Draft PR14](https://github.com/antonmarklundcom/productos.new/pull/14)
